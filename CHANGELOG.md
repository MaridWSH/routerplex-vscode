# Changelog

## 0.1.4

- Redesign the control panel as a branded webview using the product palette.
- Show API-key, Codex, current-model, and backup status in a compact status surface.
- Add search to the live RouterPlex catalog.

## 0.1.3

- Add a native RouterPlex Activity Bar control panel without a webview.
- Show API-key, Codex, current-model, and backup status in the side panel.
- List the live RouterPlex catalog and switch Codex models with one click.
- Add panel actions for setup, API keys, connection testing, refresh, updates, config, settings, and removal.
- Remove the dashboard command from the extension UI.

## 0.1.2

- Refresh the RouterPlex model catalog automatically every five minutes and when VS Code regains focus.
- Keep the last known model catalog available during temporary refresh failures.
- Check GitHub Releases for extension updates, install matching VSIX assets automatically, and prompt to reload.
- Add configurable model-refresh and extension-update intervals.

## 0.1.1

- Configure Codex with `env_key = "ROUTERPLEX_API_KEY"`.
- Export the Codex API key through the active shell profile or Windows user environment.
- Remove the file-backed extension-storage requirement and migrate legacy helper configuration.
- Add the RouterPlex logo to extension metadata.

## 0.1.0

- Add RouterPlex models to VS Code's native language-model picker.
- Configure RouterPlex as a Codex custom model provider.
- Store the VS Code API key in SecretStorage.
- Add connection testing, model refresh, and configuration removal commands.
