import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  connectDingtalkPersonal,
  DINGTALK_PERSONAL_ENDPOINTS,
  DINGTALK_PERSONAL_RPC_CHANNEL,
  disconnectDingtalkPersonal,
  fetchDingtalkPersonalStatus,
} from '../plugin-src/client/connectors/dingtalk-personal/api.js';
import {
  cacheDingtalkPersonalStatus,
  clearDingtalkPersonalStatusCache,
  deriveDingtalkPersonalView,
  DingtalkPersonalSettings,
  safeDingtalkPersonalHref,
} from '../plugin-src/client/connectors/dingtalk-personal/index.js';

const AUTH_URL = 'https://login.dingtalk.com/oauth2/auth?client_id=ding_test_client&redirect_uri=http%3A%2F%2F127.0.0.1%3A54321%2Fcallback&response_type=code&scope=openid+corpid&prompt=consent';

beforeEach(() => clearDingtalkPersonalStatusCache());

test('DingTalk personal client uses its isolated RPC contract', async () => {
  const calls = [];
  const rpcCall = async (endpoint, payload, signal) => {
    calls.push({ endpoint, payload, signal });
    return { ok: true, value: { endpoint } };
  };
  const signal = new AbortController().signal;

  assert.equal(DINGTALK_PERSONAL_RPC_CHANNEL, '/tokens-dingtalk-workspace');
  assert.equal((await fetchDingtalkPersonalStatus(rpcCall, signal)).endpoint, DINGTALK_PERSONAL_ENDPOINTS.status);
  assert.equal((await connectDingtalkPersonal(rpcCall, { force: true }, signal)).endpoint, DINGTALK_PERSONAL_ENDPOINTS.connect);
  assert.equal((await disconnectDingtalkPersonal(rpcCall, signal)).endpoint, DINGTALK_PERSONAL_ENDPOINTS.disconnect);
  assert.deepEqual(calls, [
    { endpoint: 'dingtalk/status', payload: {}, signal },
    { endpoint: 'dingtalk/connect', payload: { force: true }, signal },
    { endpoint: 'dingtalk/disconnect', payload: { confirm: true }, signal },
  ]);
});

test('DingTalk client accepts only the one-click official authorization URL', () => {
  assert.equal(safeDingtalkPersonalHref(AUTH_URL), AUTH_URL);
  assert.equal(safeDingtalkPersonalHref(AUTH_URL.replace('https:', 'http:')), undefined);
  assert.equal(safeDingtalkPersonalHref(AUTH_URL.replace('127.0.0.1', 'evil.test')), undefined);
  assert.equal(safeDingtalkPersonalHref(`${AUTH_URL}&state=unexpected`), undefined);
  assert.equal(safeDingtalkPersonalHref('javascript:alert(1)'), undefined);
  assert.equal(safeDingtalkPersonalHref(null), undefined);
});

test('DingTalk client accepts the DWS 1.0.62+ authorization URL with caller parameters', () => {
  const withCaller = `${AUTH_URL}&caller=cli&callerUmt=Test_Umt-Value123`;
  assert.equal(safeDingtalkPersonalHref(withCaller), withCaller);
  assert.equal(safeDingtalkPersonalHref(`${AUTH_URL}&corpId=dingcorp_test`), `${AUTH_URL}&corpId=dingcorp_test`);
  assert.equal(safeDingtalkPersonalHref(`${AUTH_URL}&caller=cli`), `${AUTH_URL}&caller=cli`);
  assert.equal(safeDingtalkPersonalHref(`${AUTH_URL}&callerUmt=Test_Umt`), `${AUTH_URL}&callerUmt=Test_Umt`);
  assert.equal(safeDingtalkPersonalHref(`${AUTH_URL}&caller=&callerUmt=Test_Umt`), undefined);
  assert.equal(safeDingtalkPersonalHref(`${AUTH_URL}&caller=cli&callerUmt=`), undefined);
  assert.equal(safeDingtalkPersonalHref(`${AUTH_URL}&caller=${'c'.repeat(65)}`), undefined);
  assert.equal(safeDingtalkPersonalHref(`${AUTH_URL}&callerUmt=${'u'.repeat(1025)}`), undefined);
  assert.equal(safeDingtalkPersonalHref(`${withCaller}&state=unexpected`), undefined);
});

test('DingTalk personal status normalizes a completed login immediately', () => {
  assert.deepEqual(deriveDingtalkPersonalView({
    phase: 'authorizing',
    authenticated: true,
    authorizeUrl: AUTH_URL,
  }), {
    phase: 'connected',
    connected: true,
    connecting: false,
    actionHref: undefined,
  });
});

test('DingTalk personal settings render the one-click authorization action', () => {
  cacheDingtalkPersonalStatus(undefined, {
    phase: 'authorizing',
    authorizeUrl: AUTH_URL,
    authenticated: false,
    installed: true,
    skills: { available: false, count: 0 },
  });
  const markup = renderToStaticMarkup(React.createElement(DingtalkPersonalSettings, {
    rpcCall: async () => ({ ok: true, value: {} }),
  }));
  assert.match(markup, /钉钉个人账号/);
  assert.match(markup, /打开钉钉授权页面/);
  assert.match(markup, /href="https:\/\/login\.dingtalk\.com\/oauth2\/auth\?/);
  assert.doesNotMatch(markup, /实验|deviceCode|userCode|<input/);
});
