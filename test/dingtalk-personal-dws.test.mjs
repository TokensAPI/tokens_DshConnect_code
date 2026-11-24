import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
  createDws,
  createAuthorizationUrlParser,
  runDwsProcess,
  sanitizeDwsText,
  statusFromMap,
  trustedDingtalkAuthorizationUrl,
  validateDwsToolArgs,
} from '../plugin-src/host/connectors/dingtalk-personal/dws.js';
import {
  ACCEPTED_LINKS,
  AUTH_URL,
  LOOPBACK_AUTH_URL,
  REJECTED_LINKS,
} from './dingtalk-authorization-links.mjs';

test('DWS status exposes account health without credential values', () => {
  assert.deepEqual(statusFromMap({
    authenticated: true,
    token_valid: true,
    refresh_token_valid: true,
    corp_id: 'ding_corp',
    corp_name: '测试组织',
    user_id: 'user_1',
    user_name: 'Sean',
    expires_at: '2026-09-08T00:00:00Z',
  }, 'v1.0.61'), {
    installed: true,
    version: '1.0.61',
    authenticated: true,
    tokenValid: true,
    refreshTokenValid: true,
    userName: 'Sean',
    corpName: '测试组织',
    expiresAt: '2026-09-08T00:00:00Z',
    refreshExpiresAt: null,
    message: null,
    profile: 'ding_corp:user_1',
  });
});

test('DingTalk links are trusted on origin, path, loopback callback and client id only', () => {
  for (const url of ACCEPTED_LINKS) {
    assert.equal(trustedDingtalkAuthorizationUrl(`open ${url}\n`), url, url);
  }
  for (const url of REJECTED_LINKS) {
    assert.equal(trustedDingtalkAuthorizationUrl(`open ${url}\n`), undefined, url.slice(0, 200));
  }
});

test('authorization URL parser reports an untrusted DingTalk link once, without its values', () => {
  const urls = [];
  const rejections = [];
  const parser = createAuthorizationUrlParser((url) => urls.push(url), (details) => rejections.push(details));
  assert.equal(parser.push('Starting login, help at https://example.com/help\n'), undefined);
  assert.equal(rejections.length, 0);
  const untrusted = `${LOOPBACK_AUTH_URL.replace('127.0.0.1', 'evil.test')}&secret=value-1`;
  parser.push(`{"url":"${untrusted}"}\n`);
  parser.push(`${LOOPBACK_AUTH_URL}\n`);
  assert.deepEqual(urls, []);
  assert.deepEqual(rejections, [{
    reason: 'invalid-redirect-uri',
    path: '/oauth2/auth',
    params: ['client_id', 'redirect_uri', 'response_type', 'scope', 'prompt', 'secret'],
  }]);
  assert.deepEqual(parser.rejection(), rejections[0]);
  assert.doesNotMatch(JSON.stringify(rejections), /evil|value-1|ding_test_client/);
});

test('DWS login ends at once with a clear message when the link is untrusted', async () => {
  let killed = false;
  const dws = createDws({
    ensureDws: async () => 'dws',
    dwsPath: async () => 'dws',
    installedDwsVersion: async () => 'v1.0.99',
    run: async (_bin, args, options) => {
      if (args[1] === 'status') return { code: 0, stdout: '{"authenticated":false}', stderr: '' };
      // Behaves like a login child that would wait for minutes unless it is cancelled.
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          killed = true;
          reject(new Error('dws command cancelled'));
        }, { once: true });
        options.onOutput(`${LOOPBACK_AUTH_URL.replace('127.0.0.1', 'evil.test')}\n`, 'stdout');
      });
    },
  });
  const started = Date.now();
  await assert.rejects(dws.login(undefined, () => assert.fail('untrusted link must not be shown')), (error) => {
    assert.match(error.message, /无法识别的授权链接/);
    assert.doesNotMatch(error.message, /login\.dingtalk\.com|evil/);
    assert.equal(error.dingtalkLinkRejection.reason, 'invalid-redirect-uri');
    return true;
  });
  assert.equal(killed, true);
  assert.ok(Date.now() - started < 5_000);
});

test('authorization URL parser handles a URL split across stdout chunks', () => {
  const emitted = [];
  const parser = createAuthorizationUrlParser((url) => emitted.push(url));
  const midpoint = Math.floor(LOOPBACK_AUTH_URL.length / 2);
  assert.equal(parser.push(LOOPBACK_AUTH_URL.slice(0, midpoint)), undefined);
  assert.equal(parser.push(LOOPBACK_AUTH_URL.slice(midpoint)), undefined);
  assert.equal(parser.push('\n'), LOOPBACK_AUTH_URL);
  assert.equal(parser.push(AUTH_URL), LOOPBACK_AUTH_URL);
  assert.deepEqual(emitted, [LOOPBACK_AUTH_URL]);
});

test('DWS tool accepts business argv and owns the confirmation bypass', () => {
  assert.deepEqual(validateDwsToolArgs(['todo', 'list', '--format', 'json']), [
    'todo', 'list', '--format', 'json',
  ]);
  assert.deepEqual(validateDwsToolArgs(['chat', 'message', 'send'], true), [
    'chat', 'message', 'send', '--yes',
  ]);
  assert.throws(() => validateDwsToolArgs(['auth', 'status']), /not available/);
  assert.throws(() => validateDwsToolArgs(['profile', 'switch', 'corp:user']), /only allows/);
  assert.throws(() => validateDwsToolArgs(['api', 'GET', '/v1', '--client-secret=secret']), /not allowed/);
  assert.throws(() => validateDwsToolArgs(['todo', 'create', '--yes']), /confirmed=true/);
});

test('DWS output redaction removes credential and standalone device-code values', () => {
  const redacted = sanitizeDwsText(
    '{"accessToken":"access-secret","refresh_token":"refresh-secret","deviceCode":"device-secret"}\n'
      + 'Authorization: Bearer bearer-secret\n授权码: NFSZ-GHSD\nUser Code: ABCD-EFGH\n'
      + '--token=flag-secret\n'
      + `Base link: https://login.dingtalk.com/oauth2/device/verify.htm\nRetry at ${AUTH_URL}\nOAuth: ${LOOPBACK_AUTH_URL}`,
  );
  assert.doesNotMatch(redacted, /access-secret|refresh-secret|device-secret|bearer-secret|flag-secret|NFSZ-GHSD|ABCD-EFGH|login\.dingtalk\.com/);
  assert.match(redacted, /\[REDACTED\]/);
});

function mockDws(loginResult, statusMap) {
  const calls = [];
  return {
    calls,
    dws: createDws({
      ensureDws: async () => 'dws',
      dwsPath: async () => 'dws',
      installedDwsVersion: async () => 'v1.0.61',
      run: async (_bin, args) => {
        calls.push(args);
        if (args[1] === 'login') return loginResult;
        if (args[1] === 'status') {
          return { code: 0, stdout: JSON.stringify(statusMap), stderr: '' };
        }
        throw new Error(`unexpected DWS command: ${args.join(' ')}`);
      },
    }),
  };
}

test('DWS login accepts a persisted session after the login command exits non-zero', async () => {
  const { dws, calls } = mockDws({
    code: 2,
    stdout: `${LOOPBACK_AUTH_URL}\n`,
    stderr: 'recommended permission setup failed',
  }, {
    authenticated: true,
    token_valid: true,
    refresh_token_valid: true,
    user_name: 'Sean',
    corp_name: 'Tokens',
    corp_id: 'ding_corp',
    user_id: 'user_1',
  });

  const status = await dws.login(undefined, () => {});
  assert.equal(status.authenticated, true);
  assert.equal(status.profile, 'ding_corp:user_1');
  assert.deepEqual(calls.map((args) => args.slice(0, 2)), [
    ['auth', 'login'],
    ['auth', 'status'],
  ]);
  assert.equal(calls[0].includes('--device'), false);
  assert.equal(calls[0].includes('--recommend'), true);
  assert.equal(calls[0].includes('--no-browser'), true);
});

test('DWS login exposes the redacted upstream reason when no session was persisted', async () => {
  const { dws } = mockDws({
    code: 2,
    stdout: `${LOOPBACK_AUTH_URL}\n`,
    stderr: `Organization CLI data access is disabled; device_code=device-secret; retry ${LOOPBACK_AUTH_URL}`,
  }, {
    authenticated: false,
    message: 'not authenticated',
  });

  await assert.rejects(
    dws.login(undefined, () => {}),
    (error) => {
      assert.match(error.message, /Organization CLI data access is disabled/);
      assert.match(error.message, /exit code 2/);
      assert.doesNotMatch(error.message, /device-secret|NFSZ-GHSD|login\.dingtalk\.com/);
      return true;
    },
  );
});

function hangingChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => { child.killed = true; };
  return child;
}

test('DWS child process is cancelled with the caller signal', async () => {
  const child = hangingChild();
  const controller = new AbortController();
  const pending = runDwsProcess('dws', ['todo', 'list'], {
    signal: controller.signal,
    spawnImpl: () => child,
  });
  controller.abort();
  await assert.rejects(pending, /cancelled/);
  assert.equal(child.killed, true);
});

test('DWS child process is killed on timeout', async () => {
  const child = hangingChild();
  await assert.rejects(
    runDwsProcess('dws', ['todo', 'list'], {
      timeoutMs: 10,
      spawnImpl: () => child,
    }),
    /timed out/,
  );
  assert.equal(child.killed, true);
});
