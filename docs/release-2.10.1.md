# Connection Center 2.10.1 / 连接中心 2.10.1

Date: 2026-11-18. Package: `@tokensapi/dsh-connect@2.10.1`.

## Behavior

Telegram thinking traces are opt-in. A new bot or a legacy config without
`thinkingTraces` uses the existing placeholder/final-answer delivery path;
reasoning and tool calls are not sent as individual messages. Saved `true`
still enables the 💭/🔧 messages. Saved `false` remains off. No config migration
is performed. Users with an existing explicit `true` can turn off the setting
in Telegram's conversation-behavior settings.

Only four runtime/client defaults change from the published 2.10.0 sources:
Telegram controller status, Telegram runtime bridge construction, the Telegram
settings checkbox and token-client status normalization. Other channel runtime
implementations and PitWall reconnect/delivery behavior remain unchanged.

## Source and packaging

The separate source-restoration commit imports the archived 2.10.0 sources,
tests, dependency lock and build scripts onto repository main at
`9a0b19713721ab9ee2956fe0ccbbc8346affce86`. Main's 2.9.8 session-admission
regression is retained. The release identity and workflow guard now name
`TokensAPI/tokens_DshConnect_code` after the repository transfer.

See [publishing.md](publishing.md#reproducing-and-releasing-the-210x-source-branch)
for the complete clean-checkout build, pack, private-registry publication and
redownload-verification procedure. Generated `lib/` and npm tarballs stay out
of Git; build scripts produce the two runtime entries from the checked-in source.

## Local verification

- Node 24.22.1: `npm run check` passed. Unit suite: 5,069 cases, 5,023 passed,
  46 skipped, zero failures; browser regression: 8 checks passed; build and
  package-artifact validation passed.
- Thinking-trace focused suite: 48/48 passed. Omitted/false/true legacy config
  tests exercise the real controller, runtime and bridge with a mocked Telegram
  API, both normalized and older status payloads, settings rendering, trace
  delivery, exactly one final answer and no config rewrite. The existing
  new-bot binding test verifies the default is off and explicit toggles persist.
- Actual 31-file npm tarball passed `scripts/verify-tarball.mjs`.
- Packed activation passed in isolated TokensCowork 0.5.25 (dsh 0.1.5-rc.2)
  and 0.7.15 (dsh 0.2.1-rc.2), including PDF return tool registration and all
  12 channel status routes. Temporary host homes were cleaned by the harness.
- Upstream audit passed: 736 equal paths, 51 reviewed differences, 78 fork-only
  paths, no missing upstream files or unreviewed differences. The opt-in default
  changes are explicit reviewed exceptions to the pinned upstream v5.10.0.

The 46 unit skips include real-host contract cases when no host fixture is
selected. Packed activation is separate evidence and does not claim the full
declaration-based `check:host` gate passed; historical fixture limitations are
documented in [host-compatibility.md](host-compatibility.md). No live Telegram
Bot, model call, running user profile, credentials or Bot settings were used
or changed for this verification.
