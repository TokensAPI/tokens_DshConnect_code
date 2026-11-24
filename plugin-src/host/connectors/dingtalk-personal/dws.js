import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

import {
  dwsConfigDir,
  dwsPath,
  ensureDws,
  installedDwsVersion,
} from './dws-provision.js';
import { checkDingtalkAuthorizationUrl } from '../../../shared/connectors/dingtalk-authorization-url.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const LOGIN_TIMEOUT_MS = 15 * 60_000;
const MAX_OUTPUT_SIZE = 8 * 1024 * 1024;
const MAX_ERROR_DETAIL_SIZE = 4 * 1024;
const ANSI_ESCAPE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
// Any login.dingtalk.com link in DWS output is an authorization candidate; the shared
// checker decides whether it is trusted.
const DINGTALK_LINK_PATTERN = /https?:\/\/login\.dingtalk\.com[^\s"'<>\u001b]*/gi;
const AUTH_URL_REDACTION_PATTERN = DINGTALK_LINK_PATTERN;
export const UNTRUSTED_AUTH_LINK_MESSAGE = '钉钉官方组件返回了无法识别的授权链接，请更新连接中心插件后重试。';

const ALLOWED_TOP_LEVEL = new Set([
  'agoal', 'aisearch', 'aitable', 'api', 'attendance', 'calendar', 'chat', 'contact',
  'devapp', 'devdoc', 'ding', 'doc', 'doctor', 'drive', 'event', 'hrbrain', 'live',
  'mail', 'markdown', 'minutes', 'oa', 'profile', 'recruit', 'report', 'schema',
  'sheet', 'todo', 'version', 'whiteboard', 'wiki',
]);
const SECRET_FLAGS = new Set([
  '--token', '--client-id', '--client-secret', '--mcp-url', '--pre-url',
]);

function asString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

export function sanitizeDwsText(value) {
  return String(value ?? '')
    .replace(ANSI_ESCAPE, '')
    .replace(AUTH_URL_REDACTION_PATTERN, '[DingTalk authorization link redacted]')
    .replace(/("(?:access_token|refresh_token|client_secret|device_code|user_code|accessToken|refreshToken|clientSecret|deviceCode|userCode)"\s*:\s*")[^"]*(")/gi, '$1[REDACTED]$2')
    .replace(/\b(access[_-]?token|refresh[_-]?token|client[_-]?secret|device[_-]?code|user[_-]?code)\s*([:=])\s*([^\s,;]+)/gi, '$1$2[REDACTED]')
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/((?:--token|--client-secret)(?:=|\s+))[^\s]+/gi, '$1[REDACTED]')
    .replace(/((?:授权码|验证码|user\s+code|device\s+code)\s*[:=]\s*)[A-Z0-9-]+/gi, '$1[REDACTED]');
}

function scanDingtalkLinks(value) {
  const text = String(value ?? '').replace(ANSI_ESCAPE, '');
  let firstRejection;
  for (const match of text.matchAll(DINGTALK_LINK_PATTERN)) {
    const result = checkDingtalkAuthorizationUrl(match[0]);
    if (result.ok) return { href: result.href };
    firstRejection ??= result;
  }
  return { rejection: firstRejection };
}

export function trustedDingtalkAuthorizationUrl(value) {
  return scanDingtalkLinks(value).href;
}

/**
 * Emits the first trusted link through onUrl. When complete output lines contain a
 * login.dingtalk.com link but none of them is trusted, reports the first rejection
 * (reason, path and parameter names only) through onRejected, once.
 */
export function createAuthorizationUrlParser(onUrl, onRejected) {
  let buffer = '';
  let emitted;
  let rejection;
  return Object.freeze({
    push(chunk) {
      if (emitted !== undefined || rejection !== undefined) return emitted;
      buffer = `${buffer}${String(chunk)}`.slice(-32 * 1024);
      const lineEnd = Math.max(buffer.lastIndexOf('\n'), buffer.lastIndexOf('\r'));
      if (lineEnd < 0) return undefined;
      const completeLines = buffer.slice(0, lineEnd + 1);
      buffer = buffer.slice(lineEnd + 1);
      const scan = scanDingtalkLinks(completeLines);
      if (scan.href !== undefined) {
        emitted = scan.href;
        onUrl?.(emitted);
      } else if (scan.rejection !== undefined) {
        const { ok: _ok, ...details } = scan.rejection;
        rejection = details;
        onRejected?.(details);
      }
      return emitted;
    },
    value() {
      return emitted;
    },
    rejection() {
      return rejection;
    },
  });
}

function dwsEnvironment() {
  return { ...process.env, DWS_CONFIG_DIR: dwsConfigDir() };
}

export function runDwsProcess(bin, args, {
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onOutput,
  spawnImpl = spawn,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(bin, [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: dwsEnvironment(),
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      callback();
    };
    const terminate = (message) => finish(() => {
      child.kill();
      reject(new Error(message));
    });
    const timer = setTimeout(
      () => terminate(`dws ${args[0] ?? ''} timed out after ${Math.round(timeoutMs / 1000)}s`),
      timeoutMs,
    );
    const onAbort = () => terminate('dws command cancelled');
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    const append = (stream, chunk) => {
      const text = String(chunk);
      if (stream === 'stdout') stdout += text;
      else stderr += text;
      onOutput?.(text, stream);
      if (stdout.length + stderr.length > MAX_OUTPUT_SIZE) terminate('dws output exceeded the safe limit');
    };
    child.stdout.on('data', (chunk) => append('stdout', chunk));
    child.stderr.on('data', (chunk) => append('stderr', chunk));
    child.on('error', (error) => finish(() => reject(error)));
    child.on('close', (code) => finish(() => resolve({ code: code ?? -1, stdout, stderr })));
  });
}

export function parseDwsJson(output) {
  const clean = String(output ?? '').replace(ANSI_ESCAPE, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('dws returned no JSON object');
  return JSON.parse(clean.slice(start, end + 1));
}

export function statusFromMap(map, version) {
  const authenticated = map?.authenticated === true;
  const corpId = asString(map?.corp_id) ?? asString(map?.corpId);
  const userId = asString(map?.user_id) ?? asString(map?.userId);
  return {
    installed: true,
    version: asString(version)?.replace(/^v/, '') ?? null,
    authenticated,
    tokenValid: map?.token_valid === true || map?.tokenValid === true,
    refreshTokenValid: map?.refresh_token_valid === true || map?.refreshTokenValid === true,
    userName: asString(map?.user_name) ?? asString(map?.userName) ?? null,
    corpName: asString(map?.corp_name) ?? asString(map?.corpName) ?? null,
    expiresAt: asString(map?.expires_at) ?? asString(map?.expiresAt) ?? null,
    refreshExpiresAt: asString(map?.refresh_expires_at) ?? asString(map?.refreshExpiresAt) ?? null,
    message: authenticated ? null : asString(map?.message) ?? '未登录',
    profile: corpId !== undefined && userId !== undefined ? `${corpId}:${userId}` : null,
  };
}

export function validateDwsToolArgs(args, confirmed = false) {
  if (!Array.isArray(args) || args.length === 0 || args.length > 80
    || !args.every((arg) => typeof arg === 'string' && arg !== '' && arg.length <= 16_384)) {
    throw new Error('dws args must be an array of 1 to 80 non-empty strings');
  }
  const topLevel = args[0].toLowerCase();
  if (!ALLOWED_TOP_LEVEL.has(topLevel)) {
    throw new Error(`dws command ${args[0]} is not available through this tool`);
  }
  if (topLevel === 'profile' && args[1]?.toLowerCase() !== 'list') {
    throw new Error('the dws tool only allows the read-only profile list command');
  }
  for (const arg of args) {
    const normalized = arg.toLowerCase();
    const flag = normalized.split('=', 1)[0];
    if (SECRET_FLAGS.has(flag)) throw new Error(`dws flag ${flag} is not allowed`);
    if (normalized === '--yes' || normalized === '-y') {
      throw new Error('pass confirmed=true instead of adding --yes directly');
    }
  }
  return confirmed ? [...args, '--yes'] : [...args];
}

function commandFailure(result, action) {
  const sanitized = sanitizeDwsText(result.stderr.trim() || result.stdout.trim()).trim();
  const detail = sanitized.length > MAX_ERROR_DETAIL_SIZE
    ? `${sanitized.slice(0, MAX_ERROR_DETAIL_SIZE)}\n[output truncated]`
    : sanitized;
  const exit = Number.isInteger(result.code) ? ` (exit code ${result.code})` : '';
  return new Error(`dws ${action} failed${exit}${detail === '' ? '' : `: ${detail}`}`);
}

export function createDws(internals = {}) {
  const ensureDwsImpl = internals.ensureDws ?? ensureDws;
  const dwsPathImpl = internals.dwsPath ?? dwsPath;
  const installedVersionImpl = internals.installedDwsVersion ?? installedDwsVersion;
  const runImpl = internals.run ?? runDwsProcess;

  async function run(bin, args, options) {
    await mkdir(dwsConfigDir(), { recursive: true });
    return runImpl(bin, args, options);
  }

  async function readStatus(bin, signal) {
    const result = await run(bin, ['auth', 'status', '--format', 'json'], { signal });
    try {
      return statusFromMap(parseDwsJson(result.stdout || result.stderr), await installedVersionImpl());
    } catch {
      return statusFromMap({ authenticated: false, message: '无法读取 DWS 授权状态' }, await installedVersionImpl());
    }
  }

  async function status(signal) {
    const bin = await dwsPathImpl();
    if (bin !== undefined) return readStatus(bin, signal);
    return {
      installed: false,
      version: null,
      authenticated: false,
      tokenValid: false,
      refreshTokenValid: false,
      userName: null,
      corpName: null,
      expiresAt: null,
      refreshExpiresAt: null,
      message: 'DWS 尚未安装',
      profile: null,
    };
  }

  return Object.freeze({
    async provision() {
      return ensureDwsImpl();
    },

    status,

    async login(signal, onAuthorizeUrl) {
      const bin = await ensureDwsImpl();
      // Stop this login child at once when DWS prints a DingTalk link we cannot trust,
      // instead of leaving the user without an entry until DWS times out.
      const loginAbort = new AbortController();
      const forwardAbort = () => loginAbort.abort();
      signal?.addEventListener('abort', forwardAbort, { once: true });
      if (signal?.aborted) loginAbort.abort();
      const untrustedLink = (rejection) => {
        const error = new Error(UNTRUSTED_AUTH_LINK_MESSAGE);
        error.dingtalkLinkRejection = rejection;
        return error;
      };
      const parser = createAuthorizationUrlParser(onAuthorizeUrl, () => loginAbort.abort());
      let result;
      try {
        result = await run(bin, [
          'auth', 'login', '--recommend', '--no-browser', '--format', 'json',
        ], {
          signal: loginAbort.signal,
          timeoutMs: LOGIN_TIMEOUT_MS,
          onOutput: (chunk) => parser.push(chunk),
        });
      } catch (error) {
        if (parser.rejection() !== undefined) throw untrustedLink(parser.rejection());
        throw error;
      } finally {
        signal?.removeEventListener('abort', forwardAbort);
      }
      parser.push('\n');
      if (parser.value() === undefined && parser.rejection() !== undefined) {
        const current = await readStatus(bin, signal);
        if (current.authenticated) return current;
        throw untrustedLink(parser.rejection());
      }
      const current = await readStatus(bin, signal);
      if (current.authenticated) return current;
      if (result.code !== 0) {
        throw commandFailure(result, 'auth login');
      }
      if (parser.value() === undefined) {
        throw new Error('DWS authorization did not provide a trusted DingTalk login link.');
      }
      if (!current.authenticated) throw new Error('DWS authorization finished without a valid login.');
      return current;
    },

    async logout(signal, profile) {
      const bin = await dwsPathImpl();
      if (bin === undefined) return;
      const args = ['auth', 'logout'];
      if (typeof profile === 'string' && profile !== '') args.push('--profile', profile);
      args.push('--yes', '--format', 'json');
      const result = await run(bin, args, { signal });
      if (result.code !== 0) throw commandFailure(result, 'auth logout');
    },

    async execute(args, { signal, confirmed = false } = {}) {
      const argv = validateDwsToolArgs(args, confirmed);
      const bin = await ensureDwsImpl();
      const result = await run(bin, argv, { signal });
      if (result.code !== 0) throw commandFailure(result, argv[0]);
      return {
        exitCode: result.code,
        stdout: sanitizeDwsText(result.stdout),
        stderr: sanitizeDwsText(result.stderr),
      };
    },
  });
}
