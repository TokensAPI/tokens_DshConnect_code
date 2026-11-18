import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const name = 'packed-connection-center-compatibility';
export const inject = ['connection', 'credentials', 'tools', 'typertGateway'];

export function apply(ctx) {
  const finish = (report) => {
    writeFileSync(process.env.COMPAT_REPORT, JSON.stringify(report, null, 2));
    setTimeout(() => process.exit(report.ok ? 0 : 1), 100);
  };
  const timer = setTimeout(() => finish({ ok: false, error: 'Host services did not become ready' }), 45000);
  ctx.inject(['sessionController', 'workspaceController'], (readyCtx) => {
    void (async () => {
      const plugin = await import(pathToFileURL(process.env.COMPAT_PACKAGE_ENTRY));
      await plugin.apply(readyCtx, { dshHome: process.env.DSH_HOME });
      assert.equal(readyCtx.dshIm.contractVersion, 1);
      assert.equal(typeof readyCtx.dshIm.replyChecked, 'function');
      const toolNames = ['dsh_im_return_file', 'feishu_connect'];
      for (const name of toolNames) assert.ok(readyCtx.tools.get(name), `${name} is registered`);
      const carrier = readyCtx.connection.createSharedFetchHandler('/api');
      const routes = ['/telegram', '/email', '/matrix', '/feishu', '/dingtalk', '/weixin', '/wecom', '/qq', '/slack', '/discord', '/whatsapp', '/imessage'];
      const results = [];
      for (const route of routes) {
        const endpoint = `dsh-im${route}`;
        const response = await carrier.fetch(new Request(`http://localhost/api/${endpoint}`, {
          method: 'POST', headers: { 'content-type': 'application/json', host: 'localhost' },
          body: JSON.stringify({ type: 'client-request', rpcId: 'compat-status', method: endpoint, payload: { method: 'connection.status', payload: {} } }),
        }), { principal: { kind: 'owner' } });
        assert.equal(response.status, 200, `${route} HTTP status`);
        const body = await response.json();
        assert.equal(body.result?.ok, true, `${route}: ${JSON.stringify(body.result?.error)}`);
        results.push({ route, ok: true });
      }
      clearTimeout(timer);
      finish({ ok: true, activated: true, deliveryContract: readyCtx.dshIm.contractVersion, registeredTools: toolNames, managementRoutes: results });
    })().catch((error) => {
      clearTimeout(timer);
      finish({ ok: false, error: error.message, stack: error.stack });
    });
  });
}
