import * as vscode from "vscode";

import { configureCodex, openCodexConfiguration, removeCodexConfiguration } from "./codex.js";
import {
  CODEX_LAST_MODEL_STATE_KEY,
  CODEX_MANAGED_STATE_KEY,
  DEFAULT_API_BASE_URL,
  DEFAULT_CATALOG_URL,
  DEFAULT_CODEX_MODEL,
  ROUTERPLEX_VENDOR,
} from "./constants.js";
import { CredentialManager } from "./credentials.js";
import { fetchModels, modelPriceDetail, type RouterPlexModel } from "./models.js";
import { RouterPlexLanguageModelProvider } from "./provider.js";
import { RouterPlexTreeProvider } from "./sidebar.js";
import { ExtensionUpdateService } from "./updater.js";

const DEFAULT_MODEL_REFRESH_INTERVAL_MINUTES = 5;

interface ModelQuickPickItem extends vscode.QuickPickItem {
  model: RouterPlexModel;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  let provider: RouterPlexLanguageModelProvider;
  let tree: RouterPlexTreeProvider | undefined;
  const credentials = new CredentialManager(context, () => {
    provider.refresh();
    tree?.refresh();
  });
  await credentials.restoreEnvironment();
  provider = new RouterPlexLanguageModelProvider(credentials);
  const updater = new ExtensionUpdateService(context);
  tree = new RouterPlexTreeProvider(context, credentials, provider);

  const runAndRefresh = (action: () => Promise<unknown>) =>
    runCommand(async () => {
      try {
        await action();
      } finally {
        tree?.refresh();
      }
    });

  context.subscriptions.push(
    provider,
    updater,
    tree,
    vscode.window.createTreeView("routerplex.controlPanel", {
      treeDataProvider: tree,
      showCollapseAll: true,
    }),
    provider.onDidChangeLanguageModelChatInformation(() => tree?.refresh()),
    vscode.lm.registerLanguageModelChatProvider(ROUTERPLEX_VENDOR, provider),
    vscode.commands.registerCommand("routerplex.openPanel", () =>
      vscode.commands.executeCommand("workbench.view.extension.routerplex"),
    ),
    vscode.commands.registerCommand("routerplex.setup", () => runAndRefresh(() => setup(context, credentials, provider))),
    vscode.commands.registerCommand("routerplex.manageConnection", () =>
      runAndRefresh(() => manageConnection(context, credentials, provider)),
    ),
    vscode.commands.registerCommand("routerplex.configureApiKey", () =>
      runAndRefresh(async () => {
        const key = await credentials.promptAndStore();
        if (key) vscode.window.showInformationMessage("RouterPlex API key saved securely in VS Code.");
      }),
    ),
    vscode.commands.registerCommand("routerplex.configureCodex", () =>
      runAndRefresh(() => configureCodexCommand(context, credentials)),
    ),
    vscode.commands.registerCommand("routerplex.configureCodexModel", (modelId: unknown) =>
      runAndRefresh(async () => {
        if (typeof modelId !== "string" || !modelId) throw new Error("A RouterPlex model must be selected.");
        await configureCodexCommand(context, credentials, undefined, modelId);
      }),
    ),
    vscode.commands.registerCommand("routerplex.testConnection", () =>
      runAndRefresh(async () => {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: "Testing RouterPlex connection" },
          () => credentials.test(),
        );
        vscode.window.showInformationMessage("RouterPlex connection succeeded.");
      }),
    ),
    vscode.commands.registerCommand("routerplex.refreshModels", () =>
      runAndRefresh(async () => {
        const changed = await provider.refreshFromCatalog(true);
        vscode.window.showInformationMessage(
          changed ? "RouterPlex model catalog updated." : "RouterPlex model catalog is already current.",
        );
      }),
    ),
    vscode.commands.registerCommand("routerplex.checkForUpdates", () => runAndRefresh(() => updater.check(true))),
    vscode.commands.registerCommand("routerplex.openCodexConfig", () => runAndRefresh(openCodexConfiguration)),
    vscode.commands.registerCommand("routerplex.openSettings", () =>
      vscode.commands.executeCommand("workbench.action.openSettings", "@ext:routerplex.routerplex-models"),
    ),
    vscode.commands.registerCommand("routerplex.removeConfiguration", () =>
      runAndRefresh(() => removeConfiguration(context, credentials, provider)),
    ),
    startCatalogRefresh(provider),
  );
  updater.start();
}

function startCatalogRefresh(provider: RouterPlexLanguageModelProvider): vscode.Disposable {
  let timer: ReturnType<typeof setInterval> | undefined;

  const refresh = (force: boolean) => {
    void provider.refreshFromCatalog(force).catch(() => undefined);
  };
  const schedule = () => {
    if (timer) clearInterval(timer);
    const configured = vscode.workspace
      .getConfiguration("routerplex")
      .get<number>("modelRefreshIntervalMinutes", DEFAULT_MODEL_REFRESH_INTERVAL_MINUTES);
    const interval = Math.max(1, configured) * 60 * 1000;
    timer = setInterval(() => refresh(true), interval);
  };

  const focusSubscription = vscode.window.onDidChangeWindowState((state) => {
    if (state.focused) refresh(false);
  });
  const configurationSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("routerplex.catalogUrl")) {
      provider.refresh();
      refresh(true);
    }
    if (event.affectsConfiguration("routerplex.modelRefreshIntervalMinutes")) schedule();
  });

  schedule();
  refresh(false);
  return new vscode.Disposable(() => {
    if (timer) clearInterval(timer);
    focusSubscription.dispose();
    configurationSubscription.dispose();
  });
}

async function runCommand(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(`RouterPlex: ${message}`);
  }
}

async function setup(
  context: vscode.ExtensionContext,
  credentials: CredentialManager,
  provider: RouterPlexLanguageModelProvider,
): Promise<void> {
  const apiKey = (await credentials.get()) ?? (await credentials.promptAndStore());
  if (!apiKey) return;
  await configureCodexCommand(context, credentials, apiKey);
  provider.refresh();

  const action = await vscode.window.showInformationMessage(
    "RouterPlex is available in VS Code Chat and configured for Codex. Reload VS Code before opening a new Codex chat.",
    "Reload VS Code",
  );
  if (action === "Reload VS Code") await vscode.commands.executeCommand("workbench.action.reloadWindow");
}

async function configureCodexCommand(
  context: vscode.ExtensionContext,
  credentials: CredentialManager,
  existingKey?: string,
  selectedModelId?: string,
): Promise<void> {
  const apiKey = existingKey ?? (await credentials.getOrPrompt());
  if (!apiKey) return;

  if (!context.globalState.get<boolean>(CODEX_MANAGED_STATE_KEY, false)) {
    const confirmation = await vscode.window.showWarningMessage(
      "Codex reads ROUTERPLEX_API_KEY from its environment. RouterPlex will export this key in your shell profile and back up config.toml.",
      { modal: true },
      "Continue",
    );
    if (confirmation !== "Continue") return;
  }

  const modelId = selectedModelId ?? (await pickCodexModel(context))?.id;
  if (!modelId) return;
  const baseUrl = vscode.workspace.getConfiguration("routerplex").get<string>("apiBaseUrl", DEFAULT_API_BASE_URL);
  const result = await configureCodex(context, apiKey, modelId, baseUrl);
  await vscode.window.showInformationMessage(
    `Codex now uses ${modelId} through RouterPlex. ROUTERPLEX_API_KEY was exported. Backup: ${result.backupPath}`,
  );
}

async function pickCodexModel(context: vscode.ExtensionContext): Promise<RouterPlexModel | undefined> {
  const catalogUrl = vscode.workspace.getConfiguration("routerplex").get<string>("catalogUrl", DEFAULT_CATALOG_URL);
  const models = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: "Loading RouterPlex models" },
    () => fetchModels(catalogUrl),
  );
  const lastModel = context.globalState.get<string>(CODEX_LAST_MODEL_STATE_KEY, DEFAULT_CODEX_MODEL);
  const items: ModelQuickPickItem[] = models.map((model) => ({
    label: model.id,
    description: model.id === lastModel ? "Current" : model.id === DEFAULT_CODEX_MODEL ? "Recommended" : model.provider,
    detail: modelPriceDetail(model),
    model,
  }));
  const selected = await vscode.window.showQuickPick(items, {
    title: "Choose the default RouterPlex model for Codex",
    placeHolder: DEFAULT_CODEX_MODEL,
    matchOnDescription: true,
    matchOnDetail: true,
    ignoreFocusOut: true,
  });
  return selected?.model;
}

async function manageConnection(
  context: vscode.ExtensionContext,
  credentials: CredentialManager,
  provider: RouterPlexLanguageModelProvider,
): Promise<void> {
  const hasKey = Boolean(await credentials.get());
  const codexManaged = context.globalState.get<boolean>(CODEX_MANAGED_STATE_KEY, false);
  const choice = await vscode.window.showQuickPick(
    [
      { label: "$(layout-sidebar-left) Open RouterPlex panel", command: "routerplex.openPanel" },
      { label: hasKey ? "$(key) Replace API key" : "$(key) Configure API key", command: "routerplex.configureApiKey" },
      {
        label: codexManaged ? "$(settings-gear) Change Codex model" : "$(settings-gear) Configure Codex",
        command: "routerplex.configureCodex",
      },
      { label: "$(pulse) Test connection", command: "routerplex.testConnection" },
      { label: "$(refresh) Refresh models", command: "routerplex.refreshModels" },
      { label: "$(cloud-download) Check for updates", command: "routerplex.checkForUpdates" },
      { label: "$(file-code) Open Codex configuration", command: "routerplex.openCodexConfig" },
      { label: "$(settings) Open RouterPlex settings", command: "routerplex.openSettings" },
      ...(hasKey || codexManaged
        ? [{ label: "$(trash) Remove RouterPlex configuration", command: "routerplex.removeConfiguration" }]
        : []),
    ],
    { title: "Manage RouterPlex", placeHolder: "Choose an action" },
  );
  if (choice) await vscode.commands.executeCommand(choice.command);
  provider.refresh();
}

async function removeConfiguration(
  context: vscode.ExtensionContext,
  credentials: CredentialManager,
  provider: RouterPlexLanguageModelProvider,
): Promise<void> {
  const confirmation = await vscode.window.showWarningMessage(
    "Remove the RouterPlex API key, managed environment export, and RouterPlex entries from Codex config.toml?",
    { modal: true },
    "Remove",
  );
  if (confirmation !== "Remove") return;

  const result = await removeCodexConfiguration(context);
  await credentials.clear();
  provider.refresh();
  await vscode.window.showInformationMessage(
    result.backupPath
      ? `RouterPlex configuration removed. A backup was saved at ${result.backupPath}.`
      : "RouterPlex configuration removed.",
  );
}

export function deactivate(): void {}
