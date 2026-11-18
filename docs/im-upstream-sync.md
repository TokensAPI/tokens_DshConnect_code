# IM upstream synchronization: local PitWall build 2.10.0

## Pinned integration

- Original upstream: https://github.com/xmanrui/dsh-im
- Latest stable release checked through the public GitHub release API: v5.10.0 (published 2026-11-03).
- Integrated commit: `c826bfa415d79669d8ebba206cf4a1eac554d8e2`.
- Previous integrated baseline: v4.21.2, `34a370bfef1fcf577327b822d2091d2157ded0f8`.
- Fork starting HEAD: `c2ff06743ef0facce86df925b4eccc440862f09e` (@tokensapi/dsh-connect 2.9.7).
- Scope: all upstream `src/`, `plugin-src/`, and `test/` paths, with reviewed fork differences. Supporting resources, dependencies and applicable scripts are also integrated.
- Version 2.10.0 was published to the private Registry on 2026-11-11. Its source archive is restored on the 2.10.x source branch, based on the repository main branch at `9a0b19713721ab9ee2956fe0ccbbc8346affce86`. The 2.9.8 host-admission contract tests are retained. See `publishing.md` for reproducible build and release steps.

Upstream additions include Email, Matrix, DS Bot integration, group-history and conversation-directory settings, queue and delivery changes, Telegram menu scopes, and locale changes. Their configuration and external account authorization remain opt-in.

## Preserved fork behavior

The host and client upstream entrypoints are embedded as `upstream-im.mjs` and `upstream-im.js`. The fork wrapper retains connection-center navigation, personal Feishu/DingTalk authorization, shared Feishu applications, private-registry updater, and supported Host compatibility fixes. The new shared Host peer avoids duplicate caller identities while retaining older Host operator fallback. Live assistant streaming retains revision-aware handling and recognizes both legacy and current event names.

Telegram keeps upstream single-choice cards and fork multi-select/approval buttons. The existing QQ manual credential path remains; the UNLICENSED QQ QR connector is excluded. Host credentials/tools remain external optional peers, not duplicated packages. Upstream Russian translations remain; 211 fork-only UI keys explicitly fall back to English. Chinese and English retain their fork translations.

## PitWall reconnect behavior

The reproduced failure was a polling connection error that caused the controller to destroy the Telegram runtime. The Host model continued generating the PDF, but its Harness waiter and artifact consumer had already been canceled, so the attachment had no active Telegram recipient.

The custom runtime separates the polling lifetime from the report/bridge lifetime. Automatic and manual network recovery reuse the existing runtime, bridge and artifact consumer. Calls that have not reached Telegram wait for recovery for up to five minutes of continuous waiting. On reconnection they proceed once; requests already dispatched are never automatically replayed because their remote outcome can be unknown. The existing API and rate budget survive reconnection.

This is in-memory network recovery. It does not persist pending delivery across TC/process restart, plugin unload or removal. True stop cancels pending work. Credential or configuration replacement still recreates the runtime. A timed-out or already-dispatched failed send is not promised automatic recovery.

## Source audit

`im-upstream-exceptions.json` records a reason and normalized SHA-256 for each reviewed difference. Any later content change invalidates that approval. `im-upstream-audit.json` records 740 equal paths, 47 reviewed fork differences and 76 fork-only paths, with no missing upstream paths or unreviewed differences.

```sh
npm run audit:im
npm run build
npm run test:unit
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/installed/headless_shell npm run test:browser
node scripts/verify-package.mjs
npm pack --pack-destination /path/to/output --json
node scripts/verify-tarball.mjs /path/to/output/tokensapi-dsh-connect-2.10.0.tgz
```

The Git audit requires the pinned upstream object to be fetched locally. For the next sync, compare full source content against the pinned version, review every retained difference, refresh fingerprints and rerun upstream and fork regressions.

## Verification boundaries

The four PitWall recovery regressions use the real controller, runtime, Harness ask and artifact registry with mocked external Host and Telegram endpoints. They cover reports completed during and after a disconnection, genuine shutdown cancellation, timeout, and no retry after uncertain dispatch. They do not use Bot credentials, a model, or a real Telegram chat.

Browser regression passed all eight checks using the existing local Chromium executable. Nine isolated real-Host runtime checks passed against TokensCowork's bundled dsh 0.2.1-rc.2 (workspace/session operations and model catalog). Their temporary DSH_HOME directories were removed; the running TC profile was not used.

The full `check:host` gate did not pass: the installed TC distribution omits `@deepseek-ai/dsh-api-session-controller/lib/types/types.d.ts`, so the preliminary declaration scan stops before the complete contract suite. The nine runtime checks do not replace that full static/runtime contract gate. A real Bot end-to-end check remains for installation.

Final local regression: 5,064 tests, 5,020 passed, 44 skipped, zero failures. Build, package verification, full source audit and verification of the actual 31-file npm tarball passed.

Exact product-version validation: TokensCowork 0.5.25 (dsh 0.1.5-rc.2) and 0.7.10 (dsh 0.2.1-rc.2) each passed 42 runtime/reconnect cases, packed activation, 12 management-route calls, and frontend SlotCore/LocaleRuntime contract probes. See tokenscowork-0.5.25-0.7.10.md for fixture details and boundaries. The npm tarball is unchanged.

## 2.10.1 Telegram opt-in fix

The integration remains pinned to the same upstream commit; this is not another upstream upgrade. Four defaults now require `thinkingTraces === true`: Telegram status, bridge construction, the Telegram settings checkbox, and shared token-client normalization. Existing explicit choices are preserved, and config loading performs no migration. Runtime code for other channels is unchanged from 2.10.0.

`test/channels/telegram/thinking-default.test.mjs` covers omitted/false/true saved configurations through the real controller, runtime and bridge with a mocked Telegram API. It verifies status and settings, no trace messages by default, continued reasoning and tool messages for explicit opt-in, one final answer, and byte-identical config files after reading. The existing new-bot and toggle test now asserts the opt-in default.

The upstream-difference policy records these deliberate changes, including updated fingerprints; it does not claim the four defaults are still equal to upstream.
