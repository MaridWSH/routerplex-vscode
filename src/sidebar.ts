import * as vscode from "vscode";

import {
  CODEX_LAST_BACKUP_STATE_KEY,
  CODEX_LAST_MODEL_STATE_KEY,
  CODEX_MANAGED_STATE_KEY,
  DEFAULT_CODEX_MODEL,
} from "./constants.js";
import type { CredentialManager } from "./credentials.js";
import { modelPriceDetail, type RouterPlexModel } from "./models.js";
import type { RouterPlexLanguageModelProvider } from "./provider.js";

type SectionId = "status" | "models" | "actions";

interface SectionItem {
  kind: "section";
  id: SectionId;
  label: string;
  icon: vscode.ThemeIcon;
}

interface StatusItem {
  kind: "status";
  label: string;
  description: string;
  icon: vscode.ThemeIcon;
  command?: vscode.Command;
}

interface ModelItem {
  kind: "model";
  model: RouterPlexModel;
  current: boolean;
}

interface ActionItem {
  kind: "action";
  label: string;
  description?: string;
  icon: vscode.ThemeIcon;
  command: vscode.Command;
}

type RouterPlexItem = SectionItem | StatusItem | ModelItem | ActionItem;

const SECTIONS: SectionItem[] = [
  { kind: "section", id: "status", label: "Status", icon: new vscode.ThemeIcon("pulse") },
  { kind: "section", id: "actions", label: "Actions", icon: new vscode.ThemeIcon("tools") },
  { kind: "section", id: "models", label: "Codex Models", icon: new vscode.ThemeIcon("symbol-method") },
];

export class RouterPlexTreeProvider implements vscode.TreeDataProvider<RouterPlexItem>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<RouterPlexItem | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly credentials: CredentialManager,
    private readonly provider: RouterPlexLanguageModelProvider,
  ) {}

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }

  getTreeItem(element: RouterPlexItem): vscode.TreeItem {
    if (element.kind === "section") {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
      item.id = `routerplex.${element.id}`;
      item.iconPath = element.icon;
      return item;
    }

    if (element.kind === "status") {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.description = element.description;
      item.tooltip = `${element.label}: ${element.description}`;
      item.iconPath = element.icon;
      item.command = element.command;
      return item;
    }

    if (element.kind === "model") {
      const item = new vscode.TreeItem(element.model.id, vscode.TreeItemCollapsibleState.None);
      item.description = element.current ? "Current" : element.model.provider;
      item.tooltip = `${modelPriceDetail(element.model)}. Click to use this model for Codex.`;
      item.iconPath = new vscode.ThemeIcon(element.current ? "check" : "circle-outline");
      item.command = {
        command: "routerplex.configureCodexModel",
        title: "Use Model for Codex",
        arguments: [element.model.id],
      };
      return item;
    }

    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.description = element.description;
    item.tooltip = element.description ? `${element.label}: ${element.description}` : element.label;
    item.iconPath = element.icon;
    item.command = element.command;
    return item;
  }

  async getChildren(element?: RouterPlexItem): Promise<RouterPlexItem[]> {
    if (!element) return SECTIONS;
    if (element.kind !== "section") return [];
    if (element.id === "status") return this.statusItems();
    if (element.id === "models") return this.modelItems();
    return actionItems();
  }

  private async statusItems(): Promise<RouterPlexItem[]> {
    const hasApiKey = Boolean(await this.credentials.get());
    const codexManaged = this.context.globalState.get<boolean>(CODEX_MANAGED_STATE_KEY, false);
    const currentModel = this.context.globalState.get<string>(CODEX_LAST_MODEL_STATE_KEY, DEFAULT_CODEX_MODEL);
    const lastBackup = this.context.globalState.get<string>(CODEX_LAST_BACKUP_STATE_KEY, "");

    const items: RouterPlexItem[] = [
      status("API Key", hasApiKey ? "Configured" : "Missing", hasApiKey ? "key" : "warning", "routerplex.configureApiKey"),
      status("Codex", codexManaged ? "Configured" : "Not configured", codexManaged ? "settings-gear" : "circle-slash", "routerplex.configureCodex"),
      status("Model", codexManaged ? currentModel : "None", "symbol-variable", "routerplex.configureCodex"),
    ];
    if (lastBackup) items.push(status("Last Backup", "Available", "archive", "routerplex.openCodexConfig"));
    return items;
  }

  private async modelItems(): Promise<RouterPlexItem[]> {
    const codexManaged = this.context.globalState.get<boolean>(CODEX_MANAGED_STATE_KEY, false);
    const currentModel = this.context.globalState.get<string>(CODEX_LAST_MODEL_STATE_KEY, DEFAULT_CODEX_MODEL);
    const models = await this.provider.listModels(false);
    return models.map((model) => ({ kind: "model", model, current: codexManaged && model.id === currentModel }));
  }
}

function status(label: string, description: string, icon: string, command: string): StatusItem {
  return {
    kind: "status",
    label,
    description,
    icon: new vscode.ThemeIcon(icon),
    command: { command, title: label },
  };
}

function actionItems(): RouterPlexItem[] {
  return [
    action("Run Setup", "Configure key and Codex", "rocket", "routerplex.setup"),
    action("API Key", "Add or replace key", "key", "routerplex.configureApiKey"),
    action("Test Connection", "Validate stored key", "pulse", "routerplex.testConnection"),
    action("Refresh Models", "Fetch latest catalog", "refresh", "routerplex.refreshModels"),
    action("Check Updates", "Install latest release", "cloud-download", "routerplex.checkForUpdates"),
    action("Open Codex Config", "Edit config.toml", "file-code", "routerplex.openCodexConfig"),
    action("Open Settings", "RouterPlex settings", "settings", "routerplex.openSettings"),
    action("Remove Configuration", "Remove managed settings", "trash", "routerplex.removeConfiguration"),
  ];
}

function action(label: string, description: string, icon: string, command: string): ActionItem {
  return {
    kind: "action",
    label,
    description,
    icon: new vscode.ThemeIcon(icon),
    command: { command, title: label },
  };
}
