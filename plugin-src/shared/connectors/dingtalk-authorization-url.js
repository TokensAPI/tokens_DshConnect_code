// One rule set for DingTalk authorization links, shared by the host parser and the client.
// Only the trust anchors are strict: the official origin, a known path, and for OAuth a
// loopback callback plus a client id. Other parameters and their values (scope, prompt,
// caller, ...) belong to DingTalk's CLI and may change between DWS releases.

export const DINGTALK_AUTH_URL_MAX_LENGTH = 4096;
export const DINGTALK_AUTH_URL_MAX_PARAMS = 32;

const OAUTH_PATH = '/oauth2/auth';
const DEVICE_PATH = '/oauth2/device/verify.htm';
const USER_CODE_PATTERN = /^[A-Z0-9]{4,12}(?:-[A-Z0-9]{2,12})+$/;

function rejected(reason, url) {
  return {
    ok: false,
    reason,
    path: url === undefined ? null : url.pathname.slice(0, 64),
    params: url === undefined
      ? []
      : [...new Set(url.searchParams.keys())].slice(0, DINGTALK_AUTH_URL_MAX_PARAMS)
        .map((key) => key.slice(0, 40)),
  };
}

function single(url, key) {
  const values = url.searchParams.getAll(key);
  return values.length === 1 ? values[0] : undefined;
}

function loopbackCallback(value) {
  try {
    const redirect = new URL(value);
    const port = Number(redirect.port);
    return redirect.protocol === 'http:' && redirect.hostname === '127.0.0.1'
      && Number.isInteger(port) && port >= 1 && port <= 65_535
      && redirect.pathname === '/callback' && redirect.search === '' && redirect.hash === ''
      && redirect.username === '' && redirect.password === '';
  } catch {
    return false;
  }
}

/**
 * Returns `{ ok: true, href }` for a trusted link, otherwise `{ ok: false, reason, path, params }`
 * where `path` and `params` (parameter names only) are safe to log.
 */
export function checkDingtalkAuthorizationUrl(value) {
  if (typeof value !== 'string' || value === '') return rejected('not-a-url');
  if (value.length > DINGTALK_AUTH_URL_MAX_LENGTH) return rejected('too-long');
  let url;
  try {
    url = new URL(value);
  } catch {
    return rejected('not-a-url');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'login.dingtalk.com'
    || url.port !== '' || url.username !== '' || url.password !== '') {
    return rejected('untrusted-origin', url);
  }
  if ([...url.searchParams.keys()].length > DINGTALK_AUTH_URL_MAX_PARAMS) {
    return rejected('too-many-parameters', url);
  }
  if (url.pathname === DEVICE_PATH) {
    const code = single(url, 'user_code');
    if (code === undefined || !USER_CODE_PATTERN.test(code)) return rejected('invalid-user-code', url);
    return { ok: true, href: url.href };
  }
  if (url.pathname !== OAUTH_PATH) return rejected('unknown-path', url);
  const clientId = single(url, 'client_id');
  if (clientId === undefined || clientId.trim() === '' || clientId.length > 256) {
    return rejected('invalid-client-id', url);
  }
  const redirect = single(url, 'redirect_uri');
  if (redirect === undefined || !loopbackCallback(redirect)) return rejected('invalid-redirect-uri', url);
  return { ok: true, href: url.href };
}
