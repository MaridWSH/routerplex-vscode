# RouterPlex Models for VS Code

Use the RouterPlex model catalog directly in VS Code Chat and configure
OpenAI's Codex extension with the same RouterPlex API key.

RouterPlex provides one OpenAI-compatible API for GPT, Claude, Gemini, Kimi,
DeepSeek, Qwen, and other models with prepaid billing and per-key spend limits.

## Requirements

- VS Code 1.105 or newer
- A [RouterPlex account](https://routerplex.com/sign-up)
- A funded, dedicated [RouterPlex API key](https://routerplex.com/dashboard/keys)
- The official Codex extension if you want the Codex integration

## Install

### Install the released VSIX

1. Download `routerplex-models-0.1.1.vsix` from the
   [latest GitHub release](https://github.com/MaridWSH/routerplex-vscode/releases/latest).
2. Open VS Code.
3. Open the Command Palette with `Ctrl+Shift+P` or `Cmd+Shift+P`.
4. Run **Extensions: Install from VSIX...**.
5. Select the downloaded VSIX and reload VS Code when prompted.

You can also install it from a terminal when the `code` command is available:

```bash
code --install-extension routerplex-models-0.1.1.vsix
```

### Build from source

```bash
git clone https://github.com/MaridWSH/routerplex-vscode.git
cd routerplex-vscode
npm install
npm test
npm run check
npm run package
```

Install the generated `routerplex-models-0.1.1.vsix` through
**Extensions: Install from VSIX...**.

## First-time setup

1. Open the Command Palette.
2. Run **RouterPlex: Set Up VS Code and Codex**.
3. Paste a dedicated RouterPlex API key.
4. Choose the default RouterPlex model for Codex.
5. Reload VS Code before opening a new Codex chat.

The setup command performs a connection test before saving the key. It then:

- registers the live RouterPlex chat-model catalog in VS Code;
- configures RouterPlex as a Codex custom model provider;
- exports `ROUTERPLEX_API_KEY` for Codex and new integrated terminals;
- creates a backup before changing Codex's `config.toml`;
- keeps the API key out of `config.toml`.

## Use RouterPlex in VS Code Chat

1. Open VS Code Chat.
2. Open the model picker.
3. Select a model whose provider is **RouterPlex**.
4. Send a prompt normally.

The extension uses RouterPlex's OpenAI-compatible Chat Completions endpoint for
VS Code Chat. Streaming responses and tool calls are supported. The model list
comes from RouterPlex's live public catalog and can be refreshed with
**RouterPlex: Refresh Models**.

## Use RouterPlex in Codex

Run **RouterPlex: Configure Codex** to select or change the active model. The
extension writes a managed RouterPlex provider to the user-level Codex
configuration and uses the Responses API expected by Codex.

The generated provider is equivalent to:

```toml
model_provider = "routerplex"
model = "gpt-5.6-sol"

[model_providers.routerplex]
name = "RouterPlex"
base_url = "https://api.routerplex.com/v1"
wire_api = "responses"
env_key = "ROUTERPLEX_API_KEY"
env_key_instructions = "Export ROUTERPLEX_API_KEY before starting VS Code or Codex."
```

The extension exports `ROUTERPLEX_API_KEY` in the detected shell profile on
macOS and Linux (`.bashrc`, `.zshrc`, fish config, or `.profile`). On Windows it
sets a persistent user environment variable. It also injects the variable into
new VS Code integrated terminals and the current extension host. Reload VS Code
and start a new Codex chat after configuration.

The Codex CLI and official VS Code extension share the same provider
configuration and environment variable.

## Security

- VS Code Chat uses VS Code's encrypted SecretStorage.
- Codex reads `ROUTERPLEX_API_KEY` from the process environment.
- macOS and Linux persist the export in the detected shell profile.
- Windows persists the variable in the current user's environment.
- The API key is never written into Codex's `config.toml`.
- Existing Codex configuration is backed up before every managed change.
- **RouterPlex: Remove Configuration** removes the SecretStorage key, managed
  environment export, and Codex settings while restoring the previous model.

Use a separate RouterPlex key for editor and agent usage. Give it a hard budget
and only the model access required for your workflow.

## Commands

| Command | Purpose |
| --- | --- |
| `RouterPlex: Set Up VS Code and Codex` | Complete first-time setup |
| `RouterPlex: Manage Connection` | Open the RouterPlex management menu |
| `RouterPlex: Configure API Key` | Add or replace the API key |
| `RouterPlex: Configure Codex` | Choose the Codex model and update config |
| `RouterPlex: Test Connection` | Validate the stored key |
| `RouterPlex: Refresh Models` | Reload the public model catalog |
| `RouterPlex: Open Codex Configuration` | Open the active `config.toml` |
| `RouterPlex: Remove Configuration` | Remove credentials and managed settings |
| `RouterPlex: Open Dashboard` | Open the RouterPlex dashboard |

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `routerplex.apiBaseUrl` | `https://api.routerplex.com/v1` | Inference and Codex API base URL |
| `routerplex.catalogUrl` | `https://routerplex.com/api/models` | Public live model catalog |
| `routerplex.codexHome` | Empty | Override `CODEX_HOME` or `~/.codex` |
| `routerplex.shellProfile` | Empty | Override the shell profile used for `ROUTERPLEX_API_KEY` |

## Troubleshooting

### The API key is rejected

Create a new key in the RouterPlex dashboard and make sure the account has
available credit. Run **RouterPlex: Configure API Key**, then
**RouterPlex: Test Connection**.

### RouterPlex models are missing from VS Code Chat

Confirm that VS Code is version 1.105 or newer, then run
**RouterPlex: Refresh Models** and reload the window.

### Codex still uses the previous provider

Run **RouterPlex: Configure Codex**, fully reload VS Code, and start a new Codex
chat. Use **RouterPlex: Open Codex Configuration** to inspect the active file.
In a terminal, verify the export with `printenv ROUTERPLEX_API_KEY` without
copying the value into logs or support messages.

### Remote, WSL, or container development

Run the setup command in the VS Code window connected to that environment. The
extension configures the Codex home and shell profile belonging to the
extension host where it is running. This also avoids relying on VS Code's
global-storage URI being a local `file:` URI.

## Development

```bash
npm install
npm test
npm run check
npm audit --audit-level=high
npm run package
```

The source is bundled with esbuild. Unit tests cover TOML merging and removal,
environment export management, SSE parsing, tool-call translation, and catalog
handling.

## Links

- [RouterPlex](https://routerplex.com)
- [API documentation](https://docs.routerplex.com)
- [Model catalog](https://routerplex.com/models)
- [API keys and budgets](https://routerplex.com/dashboard/keys)
- [Report an issue](https://github.com/MaridWSH/routerplex-vscode/issues)
