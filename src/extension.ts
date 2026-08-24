import * as vscode from "vscode";

import { validateApiKey } from "./api.js";
import {
  configureClaude,
  ensureClaudeDesktopStopped,
  removeClaudeConfiguration,
} from "./claude.js";
import { configureCodex, openCodexConfiguration, removeCodexConfiguration } from "./codex.js";
import {
  CLAUDE_MANAGED_STATE_KEY,
  CODEX_LAST_MODEL_STATE_KEY,
  CODEX_MANAGED_STATE_KEY,
  DEFAULT_CODEX_MODEL,
  HACKATHON_ENV_KEY,
  HACKATHON_VENDOR,
  OPENCODE_MANAGED_STATE_KEY,
} from "./constants.js";
import type { Credit } from "./console.js";
import { modelPriceDetail, type HackathonModel } from "./models.js";
import { configureOpenCode, removeOpenCodeConfiguration } from "./opencode.js";
import { HackathonModelProvider } from "./provider.js";
import { SessionStore } from "./session.js";
import { HackathonPanelProvider } from "./sidebar.js";
import { ExtensionUpdateService } from "./updater.js";

interface ModelQuickPickItem extends vscode.QuickPickItem {
  model: HackathonModel;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  let provider: HackathonModelProvider;
  let panel: HackathonPanelProvider | undefined;

  const sessions = new SessionStore(context, () => {
    provider.refresh();
    void panel?.refresh();
  });
  await sessions.restoreEnvironment();
  provider = new HackathonModelProvider(sessions);
  const updater = new ExtensionUpdateService(context);

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = "routerplexHackathon.openPanel";
  const showCredit = (credit: Credit | undefined): void => {
    if (!credit) {
      status.hide();
      return;
    }
    const left = Math.max(0, credit.member.budget - credit.member.spend);
    status.text = `$(rocket) $${left.toFixed(2)} left`;
    status.tooltip =
      `${credit.member.name}: $${credit.member.spend.toFixed(2)} of $${credit.member.budget.toFixed(2)}\n` +
      `${credit.team.name}: $${credit.team.spend.toFixed(2)} of $${credit.team.budget.toFixed(2)}`;
    status.show();
  };

  panel = new HackathonPanelProvider(context, sessions, provider, showCredit);

  const runAndRefresh = (action: () => Promise<unknown>) =>
    runCommand(async () => {
      try {
        await action();
      } finally {
        await panel?.refresh();
      }
    });

  context.subscriptions.push(
    status,
    provider,
    updater,
    panel,
    vscode.window.registerWebviewViewProvider(HackathonPanelProvider.viewId, panel, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    provider.onDidChangeLanguageModelChatInformation(() => void panel?.refresh()),
    vscode.lm.registerLanguageModelChatProvider(HACKATHON_VENDOR, provider),
    vscode.commands.registerCommand("routerplexHackathon.openPanel", () =>
      vscode.commands.executeCommand("workbench.view.extension.routerplexHackathon"),
    ),
    vscode.commands.registerCommand("routerplexHackathon.setup", () =>
      runAndRefresh(() => setup(context, sessions, provider)),
    ),
    vscode.commands.registerCommand("routerplexHackathon.join", () =>
      runAndRefresh(async () => {
        const session = await sessions.join();
        if (session) {
          provider.refresh();
          await panel?.refreshCredit();
          vscode.window.showInformationMessage(
            `You are on ${session.teamName}. ${session.models.length} hackathon models are in the chat model picker.`,
          );
        }
      }),
    ),
    vscode.commands.registerCommand("routerplexHackathon.manageConnection", () =>
      runAndRefresh(() => manageConnection(context, sessions)),
    ),
    vscode.commands.registerCommand("routerplexHackathon.configureCodex", () =>
      runAndRefresh(() => configureCodexCommand(context, sessions, provider)),
    ),
    vscode.commands.registerCommand("routerplexHackathon.configureOpenCode", () =>
      runAndRefresh(() => configureOpenCodeCommand(context, sessions, provider)),
    ),
    vscode.commands.registerCommand("routerplexHackathon.configureClaude", () =>
      runAndRefresh(() => configureClaudeCommand(context, sessions, provider)),
    ),
    vscode.commands.registerCommand("routerplexHackathon.configureCodexModel", (modelId: unknown) =>
      runAndRefresh(async () => {
        if (typeof modelId !== "string" || !modelId) throw new Error("A hackathon model must be selected.");
        await configureCodexCommand(context, sessions, provider, undefined, modelId);
      }),
    ),
    vscode.commands.registerCommand("routerplexHackathon.testConnection", () =>
      runAndRefresh(async () => {
        const session = await sessions.get();
        if (!session) throw new Error("Join the hackathon with your team code first.");
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: "Testing the hackathon gateway" },
          () => validateApiKey(session.baseUrl, session.apiKey),
        );
        await panel?.refreshCredit();
        vscode.window.showInformationMessage(`Your key works. Requests bill to ${session.teamName}.`);
      }),
    ),
    vscode.commands.registerCommand("routerplexHackathon.refreshModels", () =>
      runAndRefresh(async () => {
        const rosterChanged = await sessions.refreshRoster();
        const catalogChanged = await provider.refreshFromCatalog(true);
        vscode.window.showInformationMessage(
          rosterChanged || catalogChanged ? "Hackathon model list updated." : "Hackathon model list is already current.",
        );
      }),
    ),
    vscode.commands.registerCommand("routerplexHackathon.refresh", () =>
      runCommand(() => panel!.refreshCredit(true)),
    ),
    vscode.commands.registerCommand("routerplexHackathon.copyKey", () =>
      runCommand(async () => {
        const key = await sessions.apiKey();
        if (!key) throw new Error("Join the hackathon with your team code first.");
        await vscode.env.clipboard.writeText(key);
        vscode.window.showInformationMessage("Your hackathon API key is on the clipboard.");
      }),
    ),
    vscode.commands.registerCommand("routerplexHackathon.openChat", () =>
      vscode.commands.executeCommand("workbench.action.chat.open"),
    ),
    vscode.commands.registerCommand("routerplexHackathon.checkForUpdates", () =>
      runAndRefresh(() => updater.check(true)),
    ),
    vscode.commands.registerCommand("routerplexHackathon.openCodexConfig", () =>
      runAndRefresh(openCodexConfiguration),
    ),
    vscode.commands.registerCommand("routerplexHackathon.openSettings", () =>
      vscode.commands.executeCommand("workbench.action.openSettings", "@ext:routerplex.routerplex-hackathon"),
    ),
    vscode.commands.registerCommand("routerplexHackathon.signOut", () =>
      runAndRefresh(() => signOut(context, sessions, provider, showCredit)),
    ),
  );
  updater.start();
}

async function runCommand(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(`Hackathon: ${message}`);
  }
}

/** One command for a participant who just installed: join, wire Codex, reload. */
async function setup(
  context: vscode.ExtensionContext,
  sessions: SessionStore,
  provider: HackathonModelProvider,
): Promise<void> {
  const session = (await sessions.get()) ?? (await sessions.join());
  if (!session) return;
  await configureCodexCommand(context, sessions, provider, session.apiKey);
  provider.refresh();

  const action = await vscode.window.showInformationMessage(
    "The hackathon models are in VS Code Chat and Codex is configured. Reload VS Code before opening a new Codex chat.",
    "Reload VS Code",
  );
  if (action === "Reload VS Code") await vscode.commands.executeCommand("workbench.action.reloadWindow");
}

async function configureCodexCommand(
  context: vscode.ExtensionContext,
  sessions: SessionStore,
  provider: HackathonModelProvider,
  existingKey?: string,
  selectedModelId?: string,
): Promise<void> {
  const session = await sessions.get();
  const apiKey = existingKey ?? session?.apiKey ?? (await sessions.getOrPrompt());
  if (!apiKey) return;

  if (!context.globalState.get<boolean>(CODEX_MANAGED_STATE_KEY, false)) {
    const confirmation = await vscode.window.showWarningMessage(
      `Codex reads ${HACKATHON_ENV_KEY} from its environment. This extension will export that key in your shell profile and back up config.toml first.`,
      { modal: true },
      "Continue",
    );
    if (confirmation !== "Continue") return;
  }

  const modelId = selectedModelId ?? (await pickCodexModel(context, provider))?.id;
  if (!modelId) return;
  const baseUrl = await sessions.baseUrl();
  const result = await configureCodex(context, apiKey, modelId, baseUrl);
  await vscode.window.showInformationMessage(
    `Codex now uses ${modelId} on the hackathon gateway. ${HACKATHON_ENV_KEY} was exported. Backup: ${result.backupPath}`,
  );
}

async function configureOpenCodeCommand(
  context: vscode.ExtensionContext,
  sessions: SessionStore,
  provider: HackathonModelProvider,
): Promise<void> {
  const session = await sessions.get();
  if (!session) throw new Error("Join the hackathon with your team code first.");
  if (!context.globalState.get<boolean>(OPENCODE_MANAGED_STATE_KEY, false)) {
    const confirmation = await vscode.window.showWarningMessage(
      "This extension will add a RouterPlex Hackathon provider to your global OpenCode configuration and credential store. Existing providers are preserved and both files are backed up.",
      { modal: true },
      "Configure OpenCode",
    );
    if (confirmation !== "Configure OpenCode") return;
  }
  const models = await provider.listModels(false);
  const result = await configureOpenCode(context, session.apiKey, models, session.baseUrl);
  await vscode.window.showInformationMessage(
    `OpenCode is ready with ${models.length} hackathon models. Configuration: ${result.configPath}`,
  );
}

async function configureClaudeCommand(
  context: vscode.ExtensionContext,
  sessions: SessionStore,
  provider: HackathonModelProvider,
): Promise<void> {
  const session = await sessions.get();
  if (!session) throw new Error("Join the hackathon with your team code first.");
  await ensureClaudeDesktopStopped();
  if (!context.globalState.get<boolean>(CLAUDE_MANAGED_STATE_KEY, false)) {
    const confirmation = await vscode.window.showWarningMessage(
      "This extension will configure Claude Code and Claude Desktop third-party mode with your hackathon key. Existing JSON settings are preserved and changed files are backed up.",
      { modal: true },
      "Configure Claude",
    );
    if (confirmation !== "Configure Claude") return;
  }
  const models = await provider.listModels(false);
  const result = await configureClaude(context, session.apiKey, models, session.baseUrl);
  await vscode.window.showInformationMessage(
    `Claude Code and Claude Desktop are ready with ${models.length} hackathon models. ${result.changedFiles.length} configuration files were updated. Reopen Claude Desktop to load the profile.`,
  );
}

async function pickCodexModel(
  context: vscode.ExtensionContext,
  provider: HackathonModelProvider,
): Promise<HackathonModel | undefined> {
  const models = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: "Loading hackathon models" },
    () => provider.listModels(false),
  );
  if (models.length === 0) throw new Error("No hackathon models are available yet. Join your team first.");

  const lastModel = context.globalState.get<string>(CODEX_LAST_MODEL_STATE_KEY, DEFAULT_CODEX_MODEL);
  const items: ModelQuickPickItem[] = models.map((model) => ({
    label: model.id,
    description: model.id === lastModel ? "Current" : model.id === DEFAULT_CODEX_MODEL ? "Recommended" : model.provider,
    detail: modelPriceDetail(model),
    model,
  }));
  const selected = await vscode.window.showQuickPick(items, {
    title: "Choose the Codex model for the hackathon",
    placeHolder: DEFAULT_CODEX_MODEL,
    matchOnDescription: true,
    matchOnDetail: true,
    ignoreFocusOut: true,
  });
  return selected?.model;
}

async function manageConnection(context: vscode.ExtensionContext, sessions: SessionStore): Promise<void> {
  const joined = Boolean(await sessions.get());
  const codexManaged = context.globalState.get<boolean>(CODEX_MANAGED_STATE_KEY, false);
  const openCodeManaged = context.globalState.get<boolean>(OPENCODE_MANAGED_STATE_KEY, false);
  const claudeManaged = context.globalState.get<boolean>(CLAUDE_MANAGED_STATE_KEY, false);
  const choice = await vscode.window.showQuickPick(
    [
      { label: "$(layout-sidebar-left) Open the hackathon panel", command: "routerplexHackathon.openPanel" },
      ...(joined
        ? [
            {
              label: codexManaged ? "$(settings-gear) Change Codex model" : "$(settings-gear) Configure Codex",
              command: "routerplexHackathon.configureCodex",
            },
            {
              label: openCodeManaged ? "$(check) Reconfigure OpenCode" : "$(terminal) Configure OpenCode",
              command: "routerplexHackathon.configureOpenCode",
            },
            {
              label: claudeManaged ? "$(check) Reconfigure Claude" : "$(desktop-download) Configure Claude",
              command: "routerplexHackathon.configureClaude",
            },
            { label: "$(pulse) Test connection", command: "routerplexHackathon.testConnection" },
            { label: "$(key) Copy API key", command: "routerplexHackathon.copyKey" },
            { label: "$(refresh) Refresh models", command: "routerplexHackathon.refreshModels" },
          ]
        : [{ label: "$(rocket) Join with a team code", command: "routerplexHackathon.join" }]),
      { label: "$(cloud-download) Check for updates", command: "routerplexHackathon.checkForUpdates" },
      { label: "$(file-code) Open Codex configuration", command: "routerplexHackathon.openCodexConfig" },
      { label: "$(settings) Hackathon settings", command: "routerplexHackathon.openSettings" },
      ...(joined || codexManaged || openCodeManaged || claudeManaged
        ? [{ label: "$(sign-out) Sign out of the hackathon", command: "routerplexHackathon.signOut" }]
        : []),
    ],
    { title: "Manage the hackathon connection", placeHolder: "Choose an action" },
  );
  if (choice) await vscode.commands.executeCommand(choice.command);
}

async function signOut(
  context: vscode.ExtensionContext,
  sessions: SessionStore,
  provider: HackathonModelProvider,
  showCredit: (credit: Credit | undefined) => void,
): Promise<void> {
  const confirmation = await vscode.window.showWarningMessage(
    "Sign out on this machine? Your hackathon credentials are removed from Codex, OpenCode, Claude Code, and Claude Desktop. Your previous settings are restored, and your team code still works if you come back.",
    { modal: true },
    "Sign out",
  );
  if (confirmation !== "Sign out") return;

  if (context.globalState.get<boolean>(CLAUDE_MANAGED_STATE_KEY, false)) await ensureClaudeDesktopStopped();
  const codexResult = await removeCodexConfiguration(context);
  const [openCodeBackups, claudeBackups] = await Promise.all([
    removeOpenCodeConfiguration(context),
    removeClaudeConfiguration(context),
  ]);
  await sessions.clear();
  provider.refresh();
  showCredit(undefined);
  await vscode.window.showInformationMessage(
    codexResult.backupPath || openCodeBackups.length || claudeBackups.length
      ? "Signed out. Managed tool credentials were removed and configuration backups were saved."
      : "Signed out.",
  );
}

export function deactivate(): void {}
