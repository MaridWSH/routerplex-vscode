import * as vscode from "vscode";

import { validateApiKey } from "./api.js";
import { updateCodexEnvironment } from "./codex.js";
import { CODEX_MANAGED_STATE_KEY, DEFAULT_API_BASE_URL, ROUTERPLEX_SECRET_KEY } from "./constants.js";
import { restoreRuntimeEnvironment } from "./environment.js";
import type { ApiKeySource } from "./provider.js";

export class CredentialManager implements ApiKeySource {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly onDidChange: () => void,
  ) {}

  async get(): Promise<string | undefined> {
    return this.context.secrets.get(ROUTERPLEX_SECRET_KEY);
  }

  async getOrPrompt(): Promise<string | undefined> {
    return (await this.get()) ?? this.promptAndStore();
  }

  async restoreEnvironment(): Promise<void> {
    if (!this.context.globalState.get<boolean>(CODEX_MANAGED_STATE_KEY, false)) return;
    const apiKey = await this.get();
    if (apiKey) restoreRuntimeEnvironment(this.context, apiKey);
  }

  async promptAndStore(): Promise<string | undefined> {
    const apiKey = await vscode.window.showInputBox({
      title: "Connect RouterPlex",
      prompt: "Paste a dedicated RouterPlex API key",
      password: true,
      ignoreFocusOut: true,
      placeHolder: "sk-...",
      validateInput: (value) => (value.trim().length < 8 ? "Enter a valid RouterPlex API key." : undefined),
    });
    if (!apiKey) return undefined;

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Validating RouterPlex API key" },
      async () => {
        const baseUrl = vscode.workspace
          .getConfiguration("routerplex")
          .get<string>("apiBaseUrl", DEFAULT_API_BASE_URL);
        await validateApiKey(baseUrl, apiKey.trim());
      },
    );

    await this.context.secrets.store(ROUTERPLEX_SECRET_KEY, apiKey.trim());
    await updateCodexEnvironment(this.context, apiKey.trim());
    this.onDidChange();
    return apiKey.trim();
  }

  async test(): Promise<void> {
    const apiKey = await this.getOrPrompt();
    if (!apiKey) throw new Error("RouterPlex connection test was cancelled.");
    const baseUrl = vscode.workspace.getConfiguration("routerplex").get<string>("apiBaseUrl", DEFAULT_API_BASE_URL);
    await validateApiKey(baseUrl, apiKey);
  }

  async clear(): Promise<void> {
    await this.context.secrets.delete(ROUTERPLEX_SECRET_KEY);
    this.onDidChange();
  }
}
