import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const [root, packedClient, output] = process.argv.slice(2);
const renderRequire = createRequire(resolve(dirname(fileURLToPath(import.meta.url)), '../package.json'));
const browserReact = Object.fromEntries(['react', 'react-dom', 'react/jsx-runtime', 'react-dom/server'].map((name) => [name, renderRequire.resolve(name)]));
// This probe checks service and render contracts, not browser CSS layout.
registerHooks({ resolve(name, context, next) {
  return next(browserReact[name] ?? name, context);
}, load(url, context, next) {
  if (url.endsWith('.css')) return { format: 'module', source: 'export default Object.freeze({});', shortCircuit: true };
  return next(url, context);
} });
const require = createRequire(resolve(root, 'package.json'));
const { SlotCore } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-client-ui-slots')));
const localeSource = readFileSync(resolve(require.resolve('@deepseek-ai/dsh-client-locale/package.json'), '../lib/client.js'), 'utf8');
const imports = new Map();
for (const [, name] of localeSource.matchAll(/\brequire\("([^"]+)"\)/g)) {
  // LocaleRuntime itself does not use the host's settings-row components.
  // Those browser-only primitives are outside this service-contract probe.
  if (name.startsWith('@deepseek-ai/')) { imports.set(name, {}); continue; }
  imports.set(name, await import(pathToFileURL(require.resolve(name))));
}
const scope = { AbortController, setTimeout, clearTimeout, setInterval, clearInterval, console, navigator: { languages: ['zh-CN'], language: 'zh-CN' } };
let localeModule;
runInNewContext(localeSource, { ...scope, window: { __ModuleLoader__: { load({ factory }) { localeModule = factory((name) => imports.get(name)); } } } });
let client;
runInNewContext(readFileSync(packedClient, 'utf8'), { ...scope, window: { addEventListener() {}, removeEventListener() {}, __ModuleLoader__: { load({ id, factory }) { assert.equal(id, '@tokensapi/dsh-connect'); client = factory(require); } } } });
const core = new SlotCore();
const releaseRoot = core.register({ name: 'root', children: {
  'settings.section': { kind: 'list', scope: 'root' },
  'sidebar.session.row.leading': { kind: 'list', scope: 'root' },
} }, () => null);
const effects = [];
const services = new Map();
const ctx = {
  effect(install) { const cleanup = install(); effects.push(cleanup); return cleanup; },
  on: () => () => {}, emit: () => {},
  connection: { rpc: { call: () => new Promise(() => {}) } },
  workspaces: { listDirectory: async (path) => ({ path, entries: [] }), pickDirectory: async () => '/unused' },
  provide(name, service) { services.set(name, service); },
  slots: {
    register: (...args) => core.register(...args),
    inject(name, install) { return core.spec(name) ? ctx.effect(install) : () => {}; },
  },
};
ctx.locale = new localeModule.LocaleRuntime(ctx);
const checks = [];
try {
  client.apply(ctx);
  const panel = services.get('dshImClient');
  assert.ok(panel);
    const { renderToStaticMarkup } = renderRequire('react-dom/server');
  for (const [locale, label] of [['zh', '连接中心'], ['en', 'Connection center']]) {
    ctx.locale.setLocale(locale);
    const entries = core.entriesOfSlot('settings.section');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].options.label(), label);
    const html = renderToStaticMarkup(panel.render());
    assert.ok(html.includes('dim-panel-weixin'));
    assert.ok(html.includes('dim-tab-telegram'));
    checks.push({ locale, oneSettingsEntry: true, panelRendered: true, telegramTab: true });
  }
} finally {
  for (const dispose of effects.reverse()) if (typeof dispose === 'function') dispose();
}
assert.equal(core.entriesOfSlot('settings.section').length, 0);
releaseRoot();
const result = { ok: true, desktopVersion: JSON.parse(readFileSync(resolve(root, 'package.json'))).version, realHostLocale: true, realHostSlotCore: true, peripheralLocaleUIAndStoreStubbed: true, cssLayoutChecked: false, checks, disposed: true };
writeFileSync(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
