import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { deriveTelegramBotIdentity, TelegramConfigStore } from '../../../src/channels/telegram/config-store.mjs';
import { TelegramController } from '../../../src/channels/telegram/telegram-controller.mjs';
import { TelegramRuntime } from '../../../src/channels/telegram/telegram-runtime.mjs';
import { TelegramStateStore } from '../../../src/channels/telegram/state-store.mjs';
import { normalizeSnapshot } from '../../../plugin-src/client/channels/telegram/api.js';
import { ThinkingTracesSettings } from '../../../plugin-src/client/channels/telegram/thinking-traces.js';

const logger = { info() {}, warn() {}, error() {} };

for (const [label, stored, enabled] of [
  ['legacy config without the field', {}, false],
  ['explicit false', { thinkingTraces: false }, false],
  ['explicit true', { thinkingTraces: true }, true],
]) {
  test(`Telegram thinking traces: ${label} survives status, UI and real runtime delivery`, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'telegram-thinking-default-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const configPath = join(directory, 'config.json');
    const initial = await new TelegramConfigStore(configPath).load();
    await initial.save({
      ...deriveTelegramBotIdentity('1'),
      platformId: '1', name: 'Offline test bot', username: 'OfflineBot', ...stored,
    });
    const originalBytes = await readFile(configPath, 'utf8');
    const configStore = await new TelegramConfigStore(configPath).load();
    const state = await new TelegramStateStore(join(directory, 'state.json')).load();
    const messages = [];
    let firstUpdate = true;
    let messageId = 100;
    const api = {
      getMe: async () => ({ id: 1, is_bot: true }),
      getWebhookInfo: async () => ({}),
      setMyCommands: async () => {}, deleteMyCommands: async () => {}, setChatMenuButton: async () => {},
      sendChatAction: async () => {}, deleteMessage: async () => {}, editMessageText: async () => {},
      sendMessage: async ({ text }) => { messages.push(text); return { message_id: ++messageId }; },
      sendRichMessage: async ({ richMessage }) => {
        messages.push(richMessage.markdown); return { message_id: ++messageId };
      },
      getUpdates: async ({ timeout, signal }) => {
        if (timeout === 0) return [];
        if (firstUpdate) {
          firstUpdate = false;
          return [{ update_id: 1, message: {
            message_id: 1, chat: { id: 42, type: 'private' },
            from: { id: 7, is_bot: false }, text: 'Generate a report',
          } }];
        }
        return new Promise((resolve, reject) => {
          const abort = () => reject(signal.reason);
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
        });
      },
    };
    const harness = {
      ensureRunning: async () => true,
      sessionExists: async () => true,
      createSession: async () => 'offline-session',
      ask: async (_session, _text, options) => {
        await options.onUpdate({ type: 'reasoning', step: 0, text: 'Private model reasoning' });
        await options.onUpdate({ type: 'tool', name: 'web_search', arguments: '{"query":"test"}' });
        await options.onUpdate({ type: 'tool', name: 'bash', arguments: '{"command":"test"}' });
        return 'Final answer';
      },
    };
    const controller = new TelegramController({
      configStore, logger,
      credentials: {
        resolve: async () => ({ value: 'offline-placeholder' }),
        set: async () => {}, unset: async () => {},
      },
      createRuntime: async ({ config, token }) => new TelegramRuntime({
        config, token, state, harness, logger, createApi: () => api,
        createHttpTransport: () => ({
          destroy: async () => {},
          fetchImpl() { throw new Error('Real network is forbidden in this test'); },
        }),
      }),
    });
    t.after(() => controller.close());
    await controller.initialize();
    const snapshot = controller.status();
    assert.equal(snapshot.bots[0].thinkingTraces, enabled, 'controller status');
    const account = normalizeSnapshot(snapshot).bots[0];
    assert.equal(account.thinkingTraces, enabled, 'normalized backend status');
    // Also exercise an older backend response that omits the field entirely.
    assert.equal(normalizeSnapshot({ bots: [{ botId: account.botId, ...stored }] }).bots[0].thinkingTraces, enabled);
    for (const settingsAccount of [account, { botId: account.botId, ...stored }]) {
      const markup = renderToStaticMarkup(React.createElement(ThinkingTracesSettings, { account: settingsAccount }));
      const checkbox = markup.match(/<input[^>]*type="checkbox"[^>]*>/u)?.[0];
      assert.ok(checkbox, 'settings checkbox exists');
      assert.equal(/\schecked=/u.test(checkbox), enabled, 'settings checkbox follows explicit choice');
    }
    for (let count = 0; count < 500 && !messages.includes('Final answer'); count++) await delay(10);
    assert.equal(messages.filter(text => text === 'Final answer').length, 1, 'final answer is delivered once');
    const traces = messages.filter(text => /^[💭🔧]/u.test(text));
    assert.equal(traces.length, enabled ? 3 : 0, 'only an explicit opt-in emits reasoning and tool messages');
    if (enabled) {
      assert.ok(traces.some(text => text.startsWith('💭 ')));
      assert.ok(traces.some(text => text.startsWith('🔧 web_search')));
      assert.ok(traces.some(text => text.startsWith('🔧 bash')));
    }
    assert.equal(await readFile(configPath, 'utf8'), originalBytes, 'upgrade reads the config without migration');
    if (!Object.hasOwn(stored, 'thinkingTraces')) {
      assert.equal(Object.hasOwn(configStore.list()[0], 'thinkingTraces'), false, 'missing field stays missing');
    }
  });
}
