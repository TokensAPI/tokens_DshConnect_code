import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [hostRoot, runtime, tarball, reportFile] = process.argv.slice(2);
const directory = dirname(fileURLToPath(import.meta.url));
const repo = resolve(directory, '..');
const tar = createRequire(join(repo, 'package.json'))('tar');
const hostRequire = createRequire(join(hostRoot, 'package.json'));
const home = mkdtempSync(join(tmpdir(), 'dsh-connect-packed-home-'));
try {
  const packed = join(home, 'packed');
  mkdirSync(packed);
  await tar.x({ file: tarball, cwd: packed });
  const packageRoot = join(packed, 'package');
  symlinkSync(join(repo, 'node_modules'), join(packageRoot, 'node_modules'));
  const profile = join(home, 'profiles', 'packed-compat');
  mkdirSync(profile, { recursive: true });
  symlinkSync(join(hostRoot, 'node_modules'), join(profile, 'node_modules'));
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ private: true, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } }));
  writeFileSync(join(profile, 'cordis.yml'), '[]\n');
  writeFileSync(join(profile, 'cordis.patch.yml'), `- id: web-runtime\n  config:\n    openBrowser: false\n    printUrl: false\n- insert:\n    - id: packed-compat-probe\n      name: ${JSON.stringify(pathToFileURL(join(repo, 'test/support/packed-host-probe.mjs')).href)}\n`);
  const hook = join(home, 'host-peers.mjs');
  const peers = Object.fromEntries(['@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-credentials'].map((name) => [name, hostRequire.resolve(name)]));
  writeFileSync(hook, `import {registerHooks} from 'node:module';\nconst peers=${JSON.stringify(peers)};\nregisterHooks({resolve(s,c,n){return n(peers[s]??s,c);}});\n`);
  const report = join(home, 'report.json');
  const child = spawn(runtime, ['--expose-internals', '--import', hook, resolve(hostRequire.resolve('@deepseek-ai/dsh/package.json'), '../lib/bin.js'), '--profile', 'packed-compat', '--port', '0', '--no-open'], {
    cwd: home,
    env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: 'en_US.UTF-8', HOME: home, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: home, COMPAT_REPORT: report, COMPAT_PACKAGE_ENTRY: join(packageRoot, 'lib/index.js') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (bytes) => { output = (output + bytes).slice(-500000); });
  const timer = setTimeout(() => child.kill('SIGKILL'), 90000);
  const code = await new Promise((settle, reject) => { child.on('error', reject); child.on('exit', settle); });
  clearTimeout(timer);
  writeFileSync(`${reportFile}.log`, output);
  const data = JSON.parse(readFileSync(report, 'utf8'));
  data.desktopVersion = JSON.parse(readFileSync(join(hostRoot, 'package.json'), 'utf8')).version;
  data.hostVersion = JSON.parse(readFileSync(hostRequire.resolve('@deepseek-ai/dsh/package.json'), 'utf8')).version;
  data.exitCode = code;
  writeFileSync(reportFile, JSON.stringify(data, null, 2));
  assert.equal(data.ok, true, data.error);
  assert.equal(code, 0);
  console.log(JSON.stringify(data));
} finally { rmSync(home, { recursive: true, force: true }); }
