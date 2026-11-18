import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { TelegramRuntime } from '../../../src/channels/telegram/telegram-runtime.mjs';
import { TelegramController } from '../../../src/channels/telegram/telegram-controller.mjs';
import { TelegramStateStore } from '../../../src/channels/telegram/state-store.mjs';
import { HarnessClient } from '../../../src/channels/shared/harness-client.mjs';
import { outboundArtifactRegistry as registry } from '../../../src/channels/shared/semantic/artifact.mjs';
import { TelegramReconnectDeliveryGate } from '../../../src/channels/telegram/reconnect-delivery-gate.mjs';

async function until(predicate) {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail('offline scenario did not converge');
}

const quiet = { info() {}, warn() {}, error() {} };

for (const scenario of ['after reconnect', 'during outage', 'stop during outage']) {
  const completeWhileOffline = scenario !== 'after reconnect';
  test(`PitWall: ${scenario} preserves correct report delivery ownership`, async t => {
    const workspace = await mkdtemp(join(tmpdir(), 'pitwall-reconnect-'));
    const session = { id: 'synthetic-session', header: { id: 'synthetic-session', cwd: workspace }, events: [] };
    const state = await new TelegramStateStore(join(workspace, 'state.json')).load();
    const file = join(workspace, 'report.pdf');
    await writeFile(file, '%PDF-1.4\n% synthetic offline test artifact\n');
    let prompts = 0;
    let promptSignal;
    let rejectPoll;
    let firstUpdate = true;
    let connectionFails = false;
    let destroyed = 0;
    const files = [];
    const texts = [];
    const client = new HarnessClient({ apiProxy: {}, workspace });
    client.ensureRunning = async ({ signal } = {}) => signal?.throwIfAborted();
    const add = (type, data) => {
      const event = { type, data, seq: session.events.length, time: Date.now() };
      session.events.push(event);
      registry.observeSessionEvent(session, event, { logger: quiet });
    };
    client.rpc = async (method, payload, timeout, options = {}) => {
      options.signal?.throwIfAborted();
      if (method === 'workspace.list') return { items: [], archivedSessionIds: [] };
      if (method === 'session.list') return { items: [{ sessionId: session.id, running: true, cwd: workspace }] };
      if (method === 'session.history') return { events: session.events.map(event => ({ event })), hasMore: false };
      if (method === 'session.prompt') {
        prompts++;
        add('turn/start', { turn: 1 });
        add('user/message', { turn: 1, source: { rpcId: options.rpcId } });
        return {};
      }
      throw new Error(`Unexpected offline RPC: ${method}`);
    };
    const harness = {
      ensureRunning: client.ensureRunning,
      createSession: async () => session.id,
      ask: (id, text, options) => {
        promptSignal = options.signal;
        // Real ask/registry/bridge; only interaction transport is outside this test.
        return client.ask(id, text, { signal: options.signal, onArtifact: options.onArtifact });
      },
    };
    let messageId = 100;
    const api = {
      getMe: async () => {
        if (connectionFails) throw Object.assign(new Error('offline synthetic transport failure'), { code: 'telegram-transport-error' });
        return { id: 1, is_bot: true };
      },
      getWebhookInfo: async () => ({}),
      setMyCommands: async () => {}, deleteMyCommands: async () => {}, setChatMenuButton: async () => {},
      sendChatAction: async () => {}, deleteMessage: async () => {}, editMessageText: async () => {},
      sendMessage: async ({ text }) => { texts.push(text); return { message_id: ++messageId }; },
      sendRichMessage: async ({ richMessage }) => { texts.push(richMessage.markdown); return { message_id: ++messageId }; },
      sendDocument: async ({ chatId, file: attachment }) => {
        files.push({ chatId, bytes: Buffer.from(attachment.bytes).toString() });
        return { message_id: ++messageId };
      },
      getUpdates: ({ timeout, signal }) => {
        if (timeout === 0) return Promise.resolve([]);
        if (firstUpdate) {
          firstUpdate = false;
          return Promise.resolve([{ update_id: 1, message: {
            message_id: 1, chat: { id: 42, type: 'private' },
            from: { id: 7, is_bot: false }, text: 'Generate PitWall report',
          } }]);
        }
        return new Promise((resolve, reject) => {
          const fail = (error) => { signal.removeEventListener('abort', onAbort); reject(error); };
          const onAbort = () => fail(signal.reason);
          rejectPoll = fail;
          signal.addEventListener('abort', onAbort, { once: true });
          if (signal.aborted) onAbort();
        });
      },
    };
    const config = { botId: 'synthetic-bot', platformId: '1', tokenRef: 'synthetic-ref', username: 'OfflineBot', thinkingTraces: false };
    const runtime = new TelegramRuntime({
      config, token: 'offline-placeholder', harness, state, createApi: () => api, logger: quiet,
      createHttpTransport: () => ({ destroy: async () => { destroyed++; }, fetchImpl() { throw new Error('Network forbidden in offline test'); } }),
    });
    const controller = new TelegramController({
      credentials: { resolve: async () => ({ value: 'offline-placeholder' }), set: async () => {}, unset: async () => {} },
      configStore: { list: () => [config], get: () => config, save: async x => x, remove: async () => {} },
      createRuntime: async () => runtime, logger: quiet,
    });
    t.after(async () => {
      await controller.close();
      registry.clear();
      await rm(workspace, { recursive: true, force: true });
    });
    await controller.initialize();
    await until(() => prompts === 1 && rejectPoll);
    rejectPoll(Object.assign(new Error('synthetic poll loss'), { code: 'telegram-transport-error' }));
    await until(() => runtime.status.connectionState === 'failed');
    connectionFails = true;
    await controller.initialize();
    await controller.initialize();
    assert.equal(promptSignal.aborted, false, 'failed retries must preserve the original consumer');
    assert.equal(destroyed, 0, 'network recovery must not unload the runtime');
    const complete = async () => {
      const artifact = await registry.stage({ path: file }, { agent: { session }, callId: 'synthetic-report' });
      registry.commit(artifact);
      add('assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'Report ready.' }] } });
      add('turn/end', { turn: 1, reason: { kind: 'completed' } });
    };
    if (completeWhileOffline) {
      await complete();
      await delay(250);
      assert.equal(files.length, 0, 'no dispatch while receiver is disconnected');
    }
    if (scenario === 'stop during outage') {
      await controller.close();
      assert.equal(promptSignal.aborted, true);
      assert.equal(prompts, 1);
      assert.equal(files.length, 0, 'stop must cancel a PDF still waiting for reconnection');
      assert.equal(destroyed, 1);
      return;
    }
    connectionFails = false;
    await controller.initialize();
    assert.equal(runtime.status.ready, true);
    assert.equal(promptSignal.aborted, false);
    if (!completeWhileOffline) await complete();
    await until(() => files.length === 1);
    await until(() => runtime.status.artifactsSent === 1);
    assert.equal(prompts, 1, 'reconnect must not generate another Stint or PDF');
    assert.equal(files[0].chatId, 42);
    assert.match(files[0].bytes, /synthetic offline test artifact/);
    await controller.reconnectBot(config.botId);
    await delay(30);
    assert.equal(files.length, 1, 'later reconnect must not resend a delivered attachment');
    await controller.close();
    assert.equal(promptSignal.aborted, true, 'actual unload still cancels the bridge');
    assert.equal(destroyed, 1);
  });
}

test('PitWall gate cancels undispatched work on stop and never retries an uncertain send', async () => {
  const gate = new TelegramReconnectDeliveryGate({ timeoutMs: 50 });
  const stop = new AbortController();
  let attempts = 0;
  const api = gate.wrap({ sendDocument: async () => {
    attempts++;
    throw Object.assign(new Error('synthetic unknown delivery'), { code: 'artifact-delivery-uncertain' });
  } }, stop.signal);
  await assert.rejects(api.sendDocument({}), { code: 'artifact-delivery-uncertain' });
  assert.equal(attempts, 1);
  gate.suspend();
  await assert.rejects(api.sendDocument({}), { code: 'telegram-reconnect-timeout' });
  assert.equal(attempts, 1);
  const pending = api.sendDocument({});
  stop.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  gate.resume();
  assert.equal(attempts, 1);
});
