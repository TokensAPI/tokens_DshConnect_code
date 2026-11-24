export const AUTH_URL = 'https://login.dingtalk.com/oauth2/device/verify.htm?user_code=NFSZ-GHSD';
export const LOOPBACK_AUTH_URL = 'https://login.dingtalk.com/oauth2/auth?client_id=ding_test_client&redirect_uri=http%3A%2F%2F127.0.0.1%3A54321%2Fcallback&response_type=code&scope=openid+corpid&prompt=consent';

// Made-up values only; never real DWS output. Used by the host and client tests.
export const ACCEPTED_LINKS = [
  AUTH_URL,
  LOOPBACK_AUTH_URL,
  `${AUTH_URL}&lang=zh_CN`,
  `${LOOPBACK_AUTH_URL}&corpId=dingcorp_test`,
  `${LOOPBACK_AUTH_URL}&state=any&caller=cli&callerUmt=Test_Umt-Value123&futureParam=x`,
  LOOPBACK_AUTH_URL.replace('response_type=code', 'response_type=token')
    .replace('scope=openid+corpid', 'scope=openid+profile+more').replace('prompt=consent', 'prompt=login'),
  'https://login.dingtalk.com/oauth2/auth?redirect_uri=http%3A%2F%2F127.0.0.1%3A1%2Fcallback&client_id=ding_test',
];

export const REJECTED_LINKS = [
  AUTH_URL.replace('https:', 'http:'),
  LOOPBACK_AUTH_URL.replace('https:', 'http:'),
  LOOPBACK_AUTH_URL.replace('login.dingtalk.com', 'login.dingtalk.com.evil.test'),
  LOOPBACK_AUTH_URL.replace('login.dingtalk.com', 'evil.dingtalk.com'),
  LOOPBACK_AUTH_URL.replace('login.dingtalk.com', 'login.dingtalk.com:8443'),
  LOOPBACK_AUTH_URL.replace('https://', 'https://user:pass@'),
  LOOPBACK_AUTH_URL.replace('/oauth2/auth', '/oauth2/authorize'),
  'https://login.dingtalk.com/oauth2/device/verify.htm?user_code=bad',
  'https://login.dingtalk.com/oauth2/device/verify.htm?lang=zh_CN',
  `${AUTH_URL}&user_code=ABCD-EFGH`,
  LOOPBACK_AUTH_URL.replace('127.0.0.1', 'evil.test'),
  LOOPBACK_AUTH_URL.replace('127.0.0.1', 'localhost'),
  LOOPBACK_AUTH_URL.replace('http%3A', 'https%3A'),
  LOOPBACK_AUTH_URL.replace('%3A54321', ''),
  LOOPBACK_AUTH_URL.replace('%2Fcallback', '%2Fother'),
  LOOPBACK_AUTH_URL.replace('%2Fcallback', '%2Fcallback%3Fnext%3D1'),
  LOOPBACK_AUTH_URL.replace('client_id=ding_test_client&', ''),
  LOOPBACK_AUTH_URL.replace('client_id=ding_test_client', 'client_id=+'),
  LOOPBACK_AUTH_URL.replace(/&redirect_uri=[^&]+/, ''),
  `${LOOPBACK_AUTH_URL}&client_id=other`,
  `${LOOPBACK_AUTH_URL}&redirect_uri=http%3A%2F%2F127.0.0.1%3A54321%2Fcallback`,
  `${LOOPBACK_AUTH_URL}&redirect_uri=https://evil.test`,
  `${LOOPBACK_AUTH_URL}&pad=${'x'.repeat(4096)}`,
  `${LOOPBACK_AUTH_URL}${Array.from({ length: 28 }, (_, index) => `&p${index}=1`).join('')}`,
];
