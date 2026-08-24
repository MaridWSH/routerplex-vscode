# RouterPlex Hackathon

The participant build for the RouterPlex x Eduzah hackathon. One team code puts
the hackathon models in VS Code Chat, wires Codex, OpenCode, Claude Code, and
Claude Desktop to the same gateway, and keeps a live view of what you and your
team have left to spend.

It is the public [RouterPlex Models](https://github.com/MaridWSH/routerplex-vscode)
extension with the hackathon rules baked in: no personal API key, no public model
catalog, and nothing billable outside your team's budget.

## Three steps

1. Install the VSIX from <https://hackathon.routerplex.com>: **Extensions** ->
   **...** -> **Install from VSIX...**
2. Open the **Hackathon** icon in the Activity Bar and enter your team code.
3. Pick your name. That claims your key.

Use the **Tool setup** buttons for Codex, OpenCode, or Claude Desktop + Code.
VS Code Chat is ready as soon as you claim your seat.

## What you get

| Feature | What it does |
| --- | --- |
| Chat models | Only the models your team was granted, in the VS Code model picker |
| Codex | Writes `[model_providers.routerplex-hackathon]` into `config.toml` and exports `ROUTERPLEX_HACKATHON_API_KEY` |
| OpenCode | Adds a global `routerplex-hackathon` OpenAI-compatible provider and stores the key in OpenCode's credential file |
| Claude | Configures `~/.claude/settings.json` plus Claude Desktop's local 3P profile with the team's exact model roster |
| Credit | Your own spend and the team pool, refreshed every 30 seconds, plus a status bar total |
| Copy API key | For curl or any other OpenAI-compatible client |
| Auto update | Installs newer hackathon builds from GitHub and offers a reload |

## Budgets

Your team shares one pool and each member has a personal cap inside it. When a
meter turns amber you are at 70 percent; red is 90. Both limits are enforced by
the gateway, so a request that would go over is refused rather than billed.

## Living beside the public extension

Both extensions can be installed at once. This one uses its own vendor id,
its own secret storage entry, its own `ROUTERPLEX_HACKATHON_API_KEY`, and its own
Codex provider table, so signing out of one never disturbs the other. They do
share the Codex root `model` and `model_provider` keys - whichever you configured
last wins, and each backs up `config.toml` before touching it.

## Settings

| Setting | Default |
| --- | --- |
| `routerplexHackathon.consoleUrl` | `https://hackathon.routerplex.com` |
| `routerplexHackathon.catalogUrl` | `https://routerplex.com/api/models` |
| `routerplexHackathon.codexHome` | empty, meaning `CODEX_HOME` or `~/.codex` |
| `routerplexHackathon.shellProfile` | empty, meaning detect bash, zsh, fish, or `~/.profile` |
| `routerplexHackathon.autoUpdate` | `true` |
| `routerplexHackathon.updateCheckIntervalHours` | `6` |

## Notes for the day

- Three of these models reason before they answer. A `max_tokens` of 16 gets
  spent on reasoning and returns an empty reply; give them a few hundred.
- If your key stops working after an organiser moves you between teams, run
  **Hackathon: Join With a Team Code** again with the new code.
- Fully quit Claude Desktop before using its setup button. Reopen it after the
  extension confirms the profile was written.
- **Hackathon: Sign Out** removes the managed credentials from Codex, OpenCode,
  Claude Code, and Claude Desktop, restores prior values, and leaves backups.

## Building

```bash
npm install
npm test        # 33 checks
npm run check   # tsc --noEmit
npm run package # routerplex-hackathon-<version>.vsix
```
