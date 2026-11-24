import { checkDingtalkAuthorizationUrl } from '../../../shared/connectors/dingtalk-authorization-url.js';

export function safeDingtalkPersonalHref(value) {
  const result = checkDingtalkAuthorizationUrl(value);
  return result.ok ? result.href : undefined;
}

export function deriveDingtalkPersonalView(status) {
  if (status === undefined) {
    return { phase: 'loading', connected: false, connecting: false, actionHref: undefined };
  }
  const connected = status.authenticated === true;
  const phase = connected ? 'connected' : status.phase ?? 'idle';
  const connecting = !connected && (phase === 'preparing' || phase === 'authorizing');
  const actionHref = phase === 'authorizing'
    ? safeDingtalkPersonalHref(status.authorizeUrl)
    : undefined;
  return { phase, connected, connecting, actionHref };
}
