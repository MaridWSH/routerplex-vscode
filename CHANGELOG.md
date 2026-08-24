# Changelog

## 1.4.2

- Fixed the extension failing to load at all: the bundler resolved jsonc-parser
  to its UMD build, whose internal `require("./impl/format")` cannot be rewritten
  and is not shipped in the VSIX, so VS Code threw MODULE_NOT_FOUND on startup
  and the Hackathon control panel spun forever. The build now uses the ESM entry
  point and refuses to finish unless the bundle loads against a stub host.

## 1.4.1

- Registered control-panel commands before optional editor integrations so
  unsupported language-model APIs cannot leave toolbar commands unavailable.
- Made OpenCode and Claude configuration strictly opt-in. Joining or refreshing
  a team only updates those tools after the user enables each one explicitly.

## 1.4.0

- Added one-click OpenCode configuration with a dedicated global provider,
  team model roster, official credential-store shape, JSONC-safe merging, and
  backups.
- Added one-click Claude Code and Claude Desktop 3P setup for Windows and macOS,
  including exact hackathon model IDs and the Anthropic-compatible gateway URL.
- Reclaimed keys and refreshed model rosters now stay synchronized across all
  configured tools.
- Sign-out restores previous OpenCode and Claude settings and removes the
  managed hackathon credentials.

## 1.3.0

- The panel shows the challenge your team was dealt, with the brief and the
  RouterPlex angle, and a button through to the team board.
- New team board at `/participations`: everyone's spend, the team pool, the
  idea, and the judging rubric as a checklist your team ticks off together.
- The idea updates itself if an organiser re-deals, without rejoining.

## 1.2.0

- The console moved to `https://hackathon.routerplex.com`, so everything a
  participant touches - the download page, the team code, credit, and the
  gateway itself - is now one hostname. The old `hack.90days.online` address
  redirects there.

## 1.1.0

Rebuilt on the RouterPlex Models architecture so the hackathon build looks and
behaves like the public extension, scoped to hackathon models and the hackathon
gateway.

- Codex setup: managed `[model_providers.routerplex-hackathon]` block, a
  `config.toml` backup before every write, and `ROUTERPLEX_HACKATHON_API_KEY`
  exported to the shell profile or the Windows user environment.
- Control Panel in the RouterPlex visual language, with team and personal credit
  meters, the model list, quick actions, and utilities.
- Model rows now carry provider, context, and price, pulled from the public
  catalog and filtered to the models the console granted your team.
- Command palette coverage: setup, join, manage connection, configure Codex,
  test connection, refresh models, refresh credit, copy key, check for updates,
  open Codex configuration, settings, sign out.
- Auto update from GitHub hackathon releases, which are published under their own
  `hackathon-v*` tag so the public extension is unaffected.
- Sign out now also removes the Codex provider table and the exported variable.

## 1.0.0

First build: team code, seat claim, hackathon models in VS Code Chat, and a
credit readout.
