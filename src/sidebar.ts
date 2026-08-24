import * as vscode from "vscode";

import {
  CLAUDE_MANAGED_STATE_KEY,
  CODEX_LAST_BACKUP_STATE_KEY,
  CODEX_LAST_MODEL_STATE_KEY,
  CODEX_MANAGED_STATE_KEY,
  CREDIT_REFRESH_MS,
  DEFAULT_CODEX_MODEL,
  OPENCODE_MANAGED_STATE_KEY,
} from "./constants.js";
import { fetchCredit, type Credit } from "./console.js";
import { displayName, type HackathonModel } from "./models.js";
import type { HackathonModelProvider } from "./provider.js";
import type { SessionStore } from "./session.js";

interface PanelModel {
  id: string;
  name: string;
  provider: string;
  context: string;
  inputPrice: number;
  outputPrice: number;
  vision: boolean;
  current: boolean;
  recommended: boolean;
}

interface Meter {
  label: string;
  spend: number;
  budget: number;
}

interface PanelIdea {
  number: number;
  title: string;
  brief: string;
  angle: string;
}

interface PanelState {
  joined: boolean;
  memberName: string;
  teamName: string;
  teamCode: string;
  codexManaged: boolean;
  openCodeManaged: boolean;
  claudeManaged: boolean;
  currentModel: string;
  hasBackup: boolean;
  member: Meter | null;
  team: Meter | null;
  creditError: string;
  idea: PanelIdea | null;
  models: PanelModel[];
}

interface PanelMessage {
  type?: unknown;
  action?: unknown;
  modelId?: unknown;
  target?: unknown;
  code?: unknown;
  participantId?: unknown;
}

const COMMANDS: Record<string, string> = {
  setup: "routerplexHackathon.setup",
  join: "routerplexHackathon.join",
  configureCodex: "routerplexHackathon.configureCodex",
  configureOpenCode: "routerplexHackathon.configureOpenCode",
  configureClaude: "routerplexHackathon.configureClaude",
  testConnection: "routerplexHackathon.testConnection",
  refreshModels: "routerplexHackathon.refreshModels",
  refreshCredit: "routerplexHackathon.refresh",
  copyKey: "routerplexHackathon.copyKey",
  checkForUpdates: "routerplexHackathon.checkForUpdates",
  openCodexConfig: "routerplexHackathon.openCodexConfig",
  openSettings: "routerplexHackathon.openSettings",
  openChat: "routerplexHackathon.openChat",
  signOut: "routerplexHackathon.signOut",
};

export class HackathonPanelProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = "routerplexHackathon.controlPanel";

  private view: vscode.WebviewView | undefined;
  private revision = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastCredit: Credit | undefined;
  private creditError = "";
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly sessions: SessionStore,
    private readonly provider: HackathonModelProvider,
    private readonly onCredit: (credit: Credit | undefined) => void,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = panelHtml(view.webview);

    this.disposables.push(
      view.webview.onDidReceiveMessage((message: PanelMessage) => void this.handleMessage(message)),
      view.onDidChangeVisibility(() => {
        if (view.visible) void this.refresh();
      }),
      view.onDidDispose(() => {
        if (this.view === view) this.view = undefined;
      }),
    );
    void this.refresh();
    void this.refreshCredit();
    if (!this.timer) this.timer = setInterval(() => void this.refreshCredit(), CREDIT_REFRESH_MS);
  }

  async refresh(): Promise<void> {
    const view = this.view;
    if (!view) return;
    const revision = ++this.revision;
    const state = await this.panelState();
    if (this.view !== view || revision !== this.revision) return;
    await view.webview.postMessage({ type: "state", state });
  }

  /** Pulls team and personal spend from the console and repaints the meters. */
  async refreshCredit(interactive = false): Promise<void> {
    const session = await this.sessions.get();
    if (!session) {
      this.lastCredit = undefined;
      this.creditError = "";
      this.onCredit(undefined);
      await this.refresh();
      return;
    }
    try {
      this.lastCredit = await fetchCredit(session.consoleUrl, session.apiKey);
      await this.sessions.noteIdea(this.lastCredit.team.idea);
      this.creditError = "";
      this.onCredit(this.lastCredit);
    } catch (error) {
      this.creditError = error instanceof Error ? error.message : String(error);
      if (interactive) throw error;
    }
    await this.refresh();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
  }

  private async panelState(): Promise<PanelState> {
    const session = await this.sessions.get();
    const codexManaged = this.context.globalState.get<boolean>(CODEX_MANAGED_STATE_KEY, false);
    const openCodeManaged = this.context.globalState.get<boolean>(OPENCODE_MANAGED_STATE_KEY, false);
    const claudeManaged = this.context.globalState.get<boolean>(CLAUDE_MANAGED_STATE_KEY, false);
    const currentModel = this.context.globalState.get<string>(CODEX_LAST_MODEL_STATE_KEY, DEFAULT_CODEX_MODEL);
    const hasBackup = Boolean(this.context.globalState.get<string>(CODEX_LAST_BACKUP_STATE_KEY, ""));
    const models = session ? await this.provider.listModels(false) : [];
    const credit = this.lastCredit;

    return {
      joined: Boolean(session),
      memberName: session?.memberName ?? "",
      teamName: session?.teamName ?? "",
      teamCode: session?.teamCode ?? "",
      codexManaged,
      openCodeManaged,
      claudeManaged,
      currentModel,
      hasBackup,
      member: credit ? { label: credit.member.name, spend: credit.member.spend, budget: credit.member.budget } : null,
      team: credit ? { label: credit.team.name, spend: credit.team.spend, budget: credit.team.budget } : null,
      creditError: this.creditError,
      idea: session?.idea
        ? {
            number: session.idea.number,
            title: session.idea.title,
            brief: session.idea.brief,
            angle: session.idea.angle ?? "",
          }
        : null,
      models: models.map((model) => panelModel(model, codexManaged, currentModel)),
    };
  }

  private async handleMessage(message: PanelMessage): Promise<void> {
    try {
      if (message.type === "ready") {
        await this.refresh();
        return;
      }

      if (message.type === "command" && typeof message.action === "string") {
        const command = COMMANDS[message.action];
        if (!command) return;
        await vscode.commands.executeCommand(command);
        await this.refresh();
        return;
      }

      if (message.type === "lookup" && typeof message.code === "string") {
        const code = message.code.trim();
        if (!code) return;
        const { lookupTeam } = await import("./console.js");
        const found = await lookupTeam(this.sessions.consoleUrl(), code);
        this.post({ type: "team", code: code.toUpperCase(), team: found.team, members: found.members });
        return;
      }

      if (message.type === "claim" && typeof message.code === "string" && typeof message.participantId === "string") {
        const session = await this.sessions.claim(message.code.trim(), message.participantId);
        void vscode.window.showInformationMessage(
          `You are on ${session.teamName}. ${session.models.length} hackathon models are in the chat model picker.`,
        );
        this.provider.refresh();
        await this.refresh();
        await this.refreshCredit();
        return;
      }

      if (message.type === "selectModel" && typeof message.modelId === "string") {
        const models = await this.provider.listModels(false);
        if (!models.some((model) => model.id === message.modelId)) return;
        await vscode.commands.executeCommand("routerplexHackathon.configureCodexModel", message.modelId);
        await this.refresh();
        return;
      }

      if (message.type === "openExternal" && typeof message.target === "string") {
        const target = this.externalLink(message.target);
        if (target) await vscode.env.openExternal(vscode.Uri.parse(target));
      }
    } catch (error) {
      this.post({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  private externalLink(target: string): string | undefined {
    const consoleUrl = this.sessions.consoleUrl();
    if (target === "guide") return `${consoleUrl}/join`;
    if (target === "board") return `${consoleUrl}/participations`;
    if (target === "console") return consoleUrl;
    if (target === "routerplex") return "https://routerplex.com";
    return undefined;
  }

  private post(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }
}

function panelModel(model: HackathonModel, codexManaged: boolean, currentModel: string): PanelModel {
  return {
    id: model.id,
    name: displayName(model.id),
    provider: model.provider,
    context: model.context,
    inputPrice: model.input_per_1m,
    outputPrice: model.output_per_1m,
    vision: model.vision,
    current: codexManaged && model.id === currentModel,
    recommended: model.id === DEFAULT_CODEX_MODEL,
  };
}

function panelHtml(webview: vscode.Webview): string {
  const nonce = getNonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <title>Hackathon Control Panel</title>
  <style nonce="${nonce}">
    :root {
      color-scheme: dark;
      --rp-bg: #0b0b0a;
      --rp-panel: #131311;
      --rp-panel-raised: #171715;
      --rp-text: #ededeb;
      --rp-muted: #8a8a85;
      --rp-faint: #62625e;
      --rp-border: rgba(255, 255, 255, 0.085);
      --rp-border-strong: rgba(255, 255, 255, 0.14);
      --rp-accent: #d97757;
      --rp-accent-light: #e89175;
      --rp-success: #7ab87a;
      --rp-info: #6b9ee8;
      --rp-warning: #d9a857;
      --rp-error: #e05555;
      --rp-font: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
      --rp-mono: var(--vscode-editor-font-family, ui-monospace, monospace);
    }

    * { box-sizing: border-box; }
    html, body { min-height: 100%; }
    body {
      margin: 0;
      color: var(--rp-text);
      background-color: var(--rp-bg);
      background-image:
        linear-gradient(rgba(255, 255, 255, 0.018) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255, 255, 255, 0.018) 1px, transparent 1px);
      background-size: 24px 24px;
      font-family: var(--rp-font);
      font-size: 13px;
      -webkit-font-smoothing: antialiased;
    }
    button, input { font: inherit; }
    button { border: 0; }
    button:focus-visible, input:focus-visible, a:focus-visible {
      outline: 1px solid var(--rp-accent);
      outline-offset: 2px;
    }
    [hidden] { display: none !important; }

    .app { min-width: 0; padding-bottom: 18px; }
    .brand-bar {
      position: sticky;
      top: 0;
      z-index: 10;
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 58px;
      padding: 11px 14px;
      border-bottom: 1px solid var(--rp-border);
      background: rgba(11, 11, 10, 0.94);
      backdrop-filter: blur(12px);
    }
    .brand-mark {
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      flex: 0 0 auto;
      border: 1px solid rgba(217, 119, 87, 0.3);
      border-radius: 7px;
      color: var(--rp-accent);
      background: rgba(217, 119, 87, 0.1);
    }
    .brand-mark svg { width: 19px; height: 19px; }
    .brand-copy { min-width: 0; }
    .brand-name { font-size: 13px; font-weight: 650; line-height: 1.15; }
    .brand-label {
      margin-top: 3px;
      color: var(--rp-faint);
      font: 9px/1 var(--rp-mono);
      text-transform: uppercase;
    }
    .brand-live {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-left: auto;
      color: var(--rp-muted);
      font: 9px/1 var(--rp-mono);
      text-transform: uppercase;
    }
    .status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--rp-faint); }
    .status-dot.ready { background: var(--rp-success); box-shadow: 0 0 0 4px rgba(122, 184, 122, 0.08); }

    .content { display: grid; gap: 16px; padding: 14px; }
    .eyebrow { color: var(--rp-faint); font: 9px/1.2 var(--rp-mono); text-transform: uppercase; }
    .hero {
      overflow: hidden;
      border: 1px solid var(--rp-border);
      border-radius: 8px;
      background: rgba(19, 19, 17, 0.95);
    }
    .hero-main { padding: 15px; }
    .hero-state { display: flex; align-items: center; gap: 7px; color: var(--rp-accent); font: 9px/1 var(--rp-mono); text-transform: uppercase; }
    .hero-state.ready { color: var(--rp-success); }
    .hero h1 { margin: 8px 0 0; font-size: 20px; line-height: 1.12; font-weight: 620; }
    .hero-copy { margin: 7px 0 0; color: var(--rp-muted); font-size: 11.5px; line-height: 1.5; }
    .hero-model {
      margin-top: 11px;
      overflow: hidden;
      color: var(--rp-text);
      font: 11px/1.4 var(--rp-mono);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .hero-footer {
      display: grid;
      grid-template-columns: 1fr 1fr;
      border-top: 1px solid var(--rp-border);
      background: rgba(0, 0, 0, 0.16);
    }
    .status-cell { min-width: 0; padding: 10px 12px; }
    .status-cell + .status-cell { border-left: 1px solid var(--rp-border); }
    .status-value { margin-top: 4px; overflow: hidden; color: var(--rp-text); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }

    .meters { display: grid; gap: 10px; margin-top: 14px; }
    .meter { min-width: 0; }
    .meter-line { display: flex; min-width: 0; align-items: baseline; gap: 8px; }
    .meter-label { overflow: hidden; font-size: 10.5px; font-weight: 580; text-overflow: ellipsis; white-space: nowrap; }
    .meter-value { margin-left: auto; color: var(--rp-muted); font: 10px/1 var(--rp-mono); white-space: nowrap; }
    .meter-track { height: 5px; margin-top: 6px; overflow: hidden; border-radius: 3px; background: rgba(255, 255, 255, 0.07); }
    .meter-fill { height: 100%; border-radius: 3px; background: var(--rp-success); transition: width 220ms ease; }
    .meter-fill.warn { background: var(--rp-warning); }
    .meter-fill.over { background: var(--rp-error); }
    .meter-note { margin-top: 5px; color: var(--rp-faint); font: 9px/1.3 var(--rp-mono); }

    .join-form { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px; margin-top: 13px; }
    .seat-list { display: grid; gap: 6px; margin-top: 10px; }
    .seat-row {
      display: block;
      width: 100%;
      padding: 9px 11px;
      border: 1px solid var(--rp-border);
      border-radius: 7px;
      color: var(--rp-text);
      background: rgba(19, 19, 17, 0.94);
      text-align: left;
      cursor: pointer;
    }
    .seat-row:hover { border-color: rgba(217, 119, 87, 0.34); background: var(--rp-panel-raised); }
    .seat-row[disabled] { cursor: not-allowed; opacity: .55; }
    .seat-name { font-size: 11.5px; font-weight: 580; }
    .seat-note { display: block; margin-top: 3px; color: var(--rp-faint); font: 9px/1.3 var(--rp-mono); }

    .primary-button, .secondary-button, .action-button, .utility-button, .model-row, .link-button, .seat-row {
      transition: border-color 140ms ease, background-color 140ms ease, color 140ms ease, transform 140ms ease;
    }
    .primary-button, .secondary-button, .action-button, .utility-button, .model-row, .link-button { cursor: pointer; }
    .primary-button {
      width: 100%;
      height: 36px;
      margin-top: 13px;
      border-radius: 6px;
      color: #0a0a0a;
      background: var(--rp-accent);
      font-size: 11.5px;
      font-weight: 650;
    }
    .primary-button:hover { background: var(--rp-accent-light); }
    .primary-button:active, .action-button:active, .model-row:active { transform: translateY(1px); }

    .section-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
    .section-title { color: var(--rp-text); font-size: 11.5px; font-weight: 620; }
    .section-count { color: var(--rp-faint); font: 9.5px/1 var(--rp-mono); }
    .action-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
    .action-button {
      min-width: 0;
      min-height: 62px;
      padding: 10px;
      border: 1px solid var(--rp-border);
      border-radius: 7px;
      color: var(--rp-text);
      background: rgba(19, 19, 17, 0.94);
      text-align: left;
    }
    .action-button:hover { border-color: rgba(217, 119, 87, 0.3); background: var(--rp-panel-raised); }
    .action-kicker { color: var(--rp-accent); font: 8.5px/1 var(--rp-mono); text-transform: uppercase; }
    .action-title { display: block; margin-top: 7px; font-size: 11.5px; font-weight: 580; }
    .action-detail { display: block; margin-top: 3px; overflow: hidden; color: var(--rp-faint); font-size: 9.5px; text-overflow: ellipsis; white-space: nowrap; }

    .idea-card { padding: 13px; border: 1px solid var(--rp-border); border-radius: 8px; background: rgba(19, 19, 17, 0.94); }
    .idea-title { font-size: 12.5px; font-weight: 620; line-height: 1.3; }
    .idea-brief { margin: 7px 0 0; color: var(--rp-muted); font-size: 11px; line-height: 1.5; }
    .idea-angle { margin: 9px 0 0; padding-left: 9px; border-left: 2px solid rgba(217, 119, 87, 0.4); color: var(--rp-faint); font-size: 10.5px; line-height: 1.45; }
    .idea-card .secondary-button { width: 100%; margin-top: 11px; }
    .models-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px; margin-bottom: 8px; }
    .search-input, .code-input {
      min-width: 0;
      height: 32px;
      padding: 0 10px;
      border: 1px solid var(--rp-border);
      border-radius: 6px;
      color: var(--rp-text);
      background: rgba(19, 19, 17, 0.94);
      font-size: 11px;
    }
    .code-input { height: 34px; font-family: var(--rp-mono); letter-spacing: .08em; text-transform: uppercase; }
    .search-input::placeholder, .code-input::placeholder { color: var(--rp-faint); letter-spacing: normal; }
    .secondary-button {
      height: 32px;
      padding: 0 10px;
      border: 1px solid var(--rp-border);
      border-radius: 6px;
      color: var(--rp-muted);
      background: var(--rp-panel);
      font-size: 10.5px;
    }
    .join-form .secondary-button { height: 34px; border-color: rgba(217, 119, 87, 0.35); color: var(--rp-accent-light); }
    .secondary-button:hover { border-color: var(--rp-border-strong); color: var(--rp-text); }
    .model-list { display: grid; gap: 6px; }
    .model-row {
      display: block;
      width: 100%;
      min-width: 0;
      padding: 10px 11px;
      border: 1px solid var(--rp-border);
      border-radius: 7px;
      color: var(--rp-text);
      background: rgba(19, 19, 17, 0.94);
      text-align: left;
    }
    .model-row:hover { border-color: rgba(107, 158, 232, 0.34); background: var(--rp-panel-raised); }
    .model-row.current { border-color: rgba(217, 119, 87, 0.38); background: rgba(217, 119, 87, 0.075); }
    .model-line { display: flex; min-width: 0; align-items: center; gap: 8px; }
    .model-name { min-width: 0; overflow: hidden; font: 11px/1.3 var(--rp-mono); text-overflow: ellipsis; white-space: nowrap; }
    .badge {
      flex: 0 0 auto;
      margin-left: auto;
      padding: 3px 5px;
      border: 1px solid rgba(217, 119, 87, 0.25);
      border-radius: 4px;
      color: var(--rp-accent-light);
      background: rgba(217, 119, 87, 0.09);
      font: 8px/1 var(--rp-mono);
      text-transform: uppercase;
    }
    .badge.recommended { border-color: rgba(107, 158, 232, 0.25); color: var(--rp-info); background: rgba(107, 158, 232, 0.08); }
    .model-provider { margin-top: 4px; color: var(--rp-muted); font-size: 10px; }
    .model-meta { display: flex; min-width: 0; gap: 7px; margin-top: 7px; color: var(--rp-faint); font: 9px/1.3 var(--rp-mono); }
    .model-price { margin-left: auto; color: var(--rp-muted); white-space: nowrap; }
    .empty-state { padding: 18px 12px; border: 1px solid var(--rp-border); border-radius: 7px; color: var(--rp-muted); text-align: center; font-size: 11px; }

    .notice {
      padding: 9px 11px;
      border: 1px solid rgba(224, 85, 85, 0.35);
      border-radius: 7px;
      color: #f0b4b4;
      background: rgba(224, 85, 85, 0.08);
      font-size: 10.5px;
      line-height: 1.45;
    }

    .utilities { overflow: hidden; border: 1px solid var(--rp-border); border-radius: 8px; background: rgba(19, 19, 17, 0.94); }
    .utility-button, .link-button {
      display: flex;
      width: 100%;
      min-height: 36px;
      align-items: center;
      padding: 0 11px;
      color: var(--rp-muted);
      background: transparent;
      font-size: 10.5px;
      text-align: left;
    }
    .utility-button + .utility-button, .link-button + .link-button { border-top: 1px solid rgba(255, 255, 255, 0.045); }
    .utility-button:hover, .link-button:hover { color: var(--rp-text); background: rgba(255, 255, 255, 0.025); }
    .utility-button.danger:hover { color: var(--rp-error); }
    .utility-arrow { margin-left: auto; color: var(--rp-faint); }
    .footer-links { display: grid; grid-template-columns: repeat(3, 1fr); overflow: hidden; border: 1px solid var(--rp-border); border-radius: 7px; }
    .footer-links .link-button { justify-content: center; padding: 0 5px; }
    .footer-links .link-button + .link-button { border-top: 0; border-left: 1px solid var(--rp-border); }
    .loading { padding: 36px 14px; color: var(--rp-muted); text-align: center; font: 10px/1.5 var(--rp-mono); }

    @media (max-width: 230px) {
      .action-grid, .hero-footer, .footer-links { grid-template-columns: 1fr; }
      .status-cell + .status-cell, .footer-links .link-button + .link-button { border-left: 0; border-top: 1px solid var(--rp-border); }
      .models-toolbar, .join-form { grid-template-columns: 1fr; }
    }
    @media (prefers-reduced-motion: reduce) {
      .primary-button, .secondary-button, .action-button, .utility-button, .model-row, .link-button, .seat-row, .meter-fill { transition: none; }
    }
  </style>
</head>
<body>
  <main class="app">
    <header class="brand-bar">
      <div class="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M12 2L3 7v10l9 5 9-5V7l-9-5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
          <path d="M12 7l-4.5 2.5v5L12 17l4.5-2.5v-5L12 7z" fill="currentColor" fill-opacity=".16"/>
          <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
        </svg>
      </div>
      <div class="brand-copy">
        <div class="brand-name">RouterPlex</div>
        <div class="brand-label">Hackathon</div>
      </div>
      <div class="brand-live"><span id="brandDot" class="status-dot"></span><span id="brandStatus">Loading</span></div>
    </header>

    <div id="loading" class="loading">Loading your team...</div>
    <div id="content" class="content" hidden>
      <div id="notice" class="notice" hidden></div>

      <section class="hero">
        <div class="hero-main">
          <div id="heroState" class="hero-state"><span class="status-dot"></span><span id="heroStateText">Not joined</span></div>
          <h1 id="heroTitle">Join your team</h1>
          <p id="heroCopy" class="hero-copy">Enter the team code your organiser gave you.</p>

          <div id="joinBlock">
            <div class="join-form">
              <input id="codeInput" class="code-input" type="text" placeholder="ABC-234" autocomplete="off" spellcheck="false" aria-label="Team code">
              <button id="lookupButton" class="secondary-button" type="button">Find team</button>
            </div>
            <div id="seatList" class="seat-list"></div>
          </div>

          <div id="joinedBlock" hidden>
            <div class="meters">
              <div class="meter">
                <div class="meter-line"><span id="memberLabel" class="meter-label">You</span><span id="memberValue" class="meter-value">--</span></div>
                <div class="meter-track"><div id="memberFill" class="meter-fill" style="width: 0%"></div></div>
              </div>
              <div class="meter">
                <div class="meter-line"><span id="teamLabel" class="meter-label">Team</span><span id="teamValue" class="meter-value">--</span></div>
                <div class="meter-track"><div id="teamFill" class="meter-fill" style="width: 0%"></div></div>
                <div id="meterNote" class="meter-note">Shared across everyone on your team</div>
              </div>
            </div>
            <div id="heroModel" class="hero-model">Codex is not configured</div>
            <button id="heroAction" class="primary-button" type="button" data-action="setup">Set up Codex</button>
          </div>
        </div>
        <div class="hero-footer">
          <div class="status-cell"><div class="eyebrow">Team code</div><div id="codeStatus" class="status-value">Not joined</div></div>
          <div class="status-cell"><div class="eyebrow">Codex</div><div id="codexStatus" class="status-value">Not configured</div></div>
        </div>
      </section>

      <section id="ideaSection" hidden>
        <div class="section-heading">
          <div class="section-title">Your challenge</div>
          <div id="ideaNumber" class="section-count"></div>
        </div>
        <div class="idea-card">
          <div id="ideaTitle" class="idea-title"></div>
          <p id="ideaBrief" class="idea-brief"></p>
          <p id="ideaAngle" class="idea-angle" hidden></p>
          <button class="secondary-button" type="button" data-target="board">Open the team board</button>
        </div>
      </section>

      <section id="actionsSection" hidden>
        <div class="section-heading"><div class="section-title">Tool setup</div></div>
        <div class="action-grid">
          <button class="action-button" type="button" data-action="configureCodex"><span class="action-kicker">Codex</span><span class="action-title">Choose model</span><span id="codexActionDetail" class="action-detail">Configure provider</span></button>
          <button class="action-button" type="button" data-action="configureOpenCode"><span class="action-kicker">OpenCode</span><span class="action-title">Configure</span><span id="openCodeActionDetail" class="action-detail">Global provider</span></button>
          <button class="action-button" type="button" data-action="configureClaude"><span class="action-kicker">Claude</span><span class="action-title">Desktop + Code</span><span id="claudeActionDetail" class="action-detail">Third-party gateway</span></button>
          <button class="action-button" type="button" data-action="testConnection"><span class="action-kicker">Gateway</span><span class="action-title">Test connection</span><span class="action-detail">Check your key</span></button>
          <button class="action-button" type="button" data-action="copyKey"><span class="action-kicker">Access</span><span class="action-title">Copy API key</span><span class="action-detail">For any OpenAI client</span></button>
          <button class="action-button" type="button" data-action="refreshCredit"><span class="action-kicker">Credit</span><span class="action-title">Refresh credit</span><span id="creditActionDetail" class="action-detail">Live team spend</span></button>
        </div>
      </section>

      <section id="modelsSection" hidden>
        <div class="section-heading">
          <div class="section-title">Hackathon models</div>
          <div id="modelCount" class="section-count">0 models</div>
        </div>
        <div class="models-toolbar">
          <input id="modelSearch" class="search-input" type="search" placeholder="Search models" aria-label="Search hackathon models">
          <button id="currentFilter" class="secondary-button" type="button" aria-pressed="false">Current</button>
        </div>
        <div id="modelList" class="model-list"></div>
      </section>

      <section>
        <div class="section-heading"><div class="section-title">Utilities</div></div>
        <div class="utilities">
          <button id="chatButton" class="utility-button" type="button" data-action="openChat">Open the Chat view<span class="utility-arrow">&rsaquo;</span></button>
          <button id="refreshModelsButton" class="utility-button" type="button" data-action="refreshModels">Refresh model list<span class="utility-arrow">&rsaquo;</span></button>
          <button class="utility-button" type="button" data-action="checkForUpdates">Check for extension updates<span class="utility-arrow">&rsaquo;</span></button>
          <button class="utility-button" type="button" data-action="openCodexConfig">Open Codex configuration<span id="backupLabel" class="utility-arrow">&rsaquo;</span></button>
          <button class="utility-button" type="button" data-action="openSettings">Hackathon settings<span class="utility-arrow">&rsaquo;</span></button>
          <button id="signOutButton" class="utility-button danger" type="button" data-action="signOut">Sign out of the hackathon<span class="utility-arrow">&rsaquo;</span></button>
        </div>
      </section>

      <nav class="footer-links" aria-label="Hackathon links">
        <button class="link-button" type="button" data-target="guide">Guide</button>
        <button class="link-button" type="button" data-target="board">Board</button>
        <button class="link-button" type="button" data-target="routerplex">RouterPlex</button>
      </nav>
    </div>
  </main>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let panelState = null;
    let currentOnly = false;
    let lookupCode = "";

    const elements = {
      loading: document.getElementById("loading"),
      content: document.getElementById("content"),
      notice: document.getElementById("notice"),
      brandDot: document.getElementById("brandDot"),
      brandStatus: document.getElementById("brandStatus"),
      heroState: document.getElementById("heroState"),
      heroStateText: document.getElementById("heroStateText"),
      heroTitle: document.getElementById("heroTitle"),
      heroCopy: document.getElementById("heroCopy"),
      heroModel: document.getElementById("heroModel"),
      heroAction: document.getElementById("heroAction"),
      joinBlock: document.getElementById("joinBlock"),
      joinedBlock: document.getElementById("joinedBlock"),
      codeInput: document.getElementById("codeInput"),
      lookupButton: document.getElementById("lookupButton"),
      seatList: document.getElementById("seatList"),
      memberLabel: document.getElementById("memberLabel"),
      memberValue: document.getElementById("memberValue"),
      memberFill: document.getElementById("memberFill"),
      teamLabel: document.getElementById("teamLabel"),
      teamValue: document.getElementById("teamValue"),
      teamFill: document.getElementById("teamFill"),
      meterNote: document.getElementById("meterNote"),
      codeStatus: document.getElementById("codeStatus"),
      codexStatus: document.getElementById("codexStatus"),
      codexActionDetail: document.getElementById("codexActionDetail"),
      openCodeActionDetail: document.getElementById("openCodeActionDetail"),
      claudeActionDetail: document.getElementById("claudeActionDetail"),
      creditActionDetail: document.getElementById("creditActionDetail"),
      actionsSection: document.getElementById("actionsSection"),
      modelsSection: document.getElementById("modelsSection"),
      ideaSection: document.getElementById("ideaSection"),
      ideaNumber: document.getElementById("ideaNumber"),
      ideaTitle: document.getElementById("ideaTitle"),
      ideaBrief: document.getElementById("ideaBrief"),
      ideaAngle: document.getElementById("ideaAngle"),
      modelCount: document.getElementById("modelCount"),
      modelSearch: document.getElementById("modelSearch"),
      currentFilter: document.getElementById("currentFilter"),
      modelList: document.getElementById("modelList"),
      backupLabel: document.getElementById("backupLabel"),
      signOutButton: document.getElementById("signOutButton"),
      refreshModelsButton: document.getElementById("refreshModelsButton"),
    };

    function setText(element, value) {
      if (element) element.textContent = value;
    }

    function money(value) {
      return "$" + Number(value || 0).toFixed(2);
    }

    function formatPrice(value) {
      return Number.isInteger(value) ? String(value) : String(value).replace(/0+$/, "").replace(/\.$/, "");
    }

    function renderMeter(meter, labelElement, valueElement, fillElement, fallbackLabel) {
      if (!meter) {
        setText(labelElement, fallbackLabel);
        setText(valueElement, "waiting");
        fillElement.style.width = "0%";
        fillElement.className = "meter-fill";
        return;
      }
      const budget = Number(meter.budget) || 0;
      const spend = Number(meter.spend) || 0;
      const used = budget > 0 ? Math.min(1, spend / budget) : 0;
      setText(labelElement, meter.label || fallbackLabel);
      setText(valueElement, money(Math.max(0, budget - spend)) + " left of " + money(budget));
      fillElement.style.width = (used * 100).toFixed(1) + "%";
      fillElement.className = "meter-fill" + (used >= 0.9 ? " over" : used >= 0.7 ? " warn" : "");
    }

    function renderState(state) {
      panelState = state;
      elements.loading.hidden = true;
      elements.content.hidden = false;

      const joined = state.joined;
      const ready = joined && state.codexManaged;
      elements.brandDot.classList.toggle("ready", joined);
      const left = state.member ? money(Math.max(0, state.member.budget - state.member.spend)) + " left" : "Not joined";
      setText(elements.brandStatus, joined ? left : "Not joined");

      elements.heroState.classList.toggle("ready", joined);
      setText(elements.heroStateText, joined ? (ready ? "Ready" : "Joined") : "Not joined");
      setText(elements.heroTitle, joined ? state.teamName : "Join your team");
      setText(elements.heroCopy, joined
        ? state.memberName + " - your key is stored in VS Code and the models are in the chat picker."
        : "Enter the team code your organiser gave you.");

      elements.joinBlock.hidden = joined;
      elements.joinedBlock.hidden = !joined;
      elements.actionsSection.hidden = !joined;
      elements.modelsSection.hidden = !joined;
      elements.signOutButton.hidden = !joined;
      elements.ideaSection.hidden = !joined || !state.idea;
      if (state.idea) {
        setText(elements.ideaNumber, "Challenge " + state.idea.number);
        setText(elements.ideaTitle, state.idea.title);
        setText(elements.ideaBrief, state.idea.brief);
        setText(elements.ideaAngle, state.idea.angle);
        elements.ideaAngle.hidden = !state.idea.angle;
      }
      elements.refreshModelsButton.hidden = !joined;

      renderMeter(state.member, elements.memberLabel, elements.memberValue, elements.memberFill, "You");
      renderMeter(state.team, elements.teamLabel, elements.teamValue, elements.teamFill, "Team");
      setText(elements.meterNote, state.creditError ? "Credit is stale: " + state.creditError : "Shared across everyone on your team");

      setText(elements.heroModel, state.codexManaged ? "Codex model: " + state.currentModel : "Codex is not configured");
      setText(elements.heroAction, ready ? "Test connection" : "Set up Codex");
      elements.heroAction.dataset.action = ready ? "testConnection" : "setup";
      setText(elements.codeStatus, joined ? state.teamCode : "Not joined");
      setText(elements.codexStatus, state.codexManaged ? "Configured" : "Not configured");
      setText(elements.codexActionDetail, state.codexManaged ? state.currentModel : "Configure provider");
      setText(elements.openCodeActionDetail, state.openCodeManaged ? "Configured" : "Global provider");
      setText(elements.claudeActionDetail, state.claudeManaged ? "Configured" : "Third-party gateway");
      setText(elements.creditActionDetail, state.creditError ? "Last refresh failed" : "Live team spend");
      setText(elements.modelCount, state.models.length + (state.models.length === 1 ? " model" : " models"));
      setText(elements.backupLabel, state.hasBackup ? "Backup available" : "›");
      if (joined) elements.seatList.replaceChildren();
      renderModels();
    }

    function renderSeats(payload) {
      lookupCode = payload.code;
      elements.seatList.replaceChildren();
      setText(elements.heroCopy, "Pick your name on " + payload.team.name + ".");
      for (const member of payload.members) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "seat-row";
        row.dataset.participantId = member.id;
        if (!member.ready) row.disabled = true;
        const name = document.createElement("span");
        name.className = "seat-name";
        name.textContent = member.name;
        row.appendChild(name);
        const note = document.createElement("span");
        note.className = "seat-note";
        note.textContent = !member.ready
          ? "No key yet - ask the organiser to provision"
          : member.claimed
            ? "Already claimed on another machine"
            : "Tap to claim your key";
        row.appendChild(note);
        elements.seatList.appendChild(row);
      }
      if (payload.members.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "That team has nobody on it yet.";
        elements.seatList.appendChild(empty);
      }
    }

    function renderModels() {
      if (!panelState) return;
      const query = elements.modelSearch.value.trim().toLowerCase();
      const models = panelState.models
        .filter(function (model) {
          const matchesQuery = !query || model.id.toLowerCase().includes(query) || model.provider.toLowerCase().includes(query) || model.name.toLowerCase().includes(query);
          return matchesQuery && (!currentOnly || model.current);
        })
        .sort(function (left, right) { return Number(right.current) - Number(left.current); });

      elements.modelList.replaceChildren();
      if (models.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = currentOnly ? "No Codex model chosen yet." : "No models match this search.";
        elements.modelList.appendChild(empty);
        return;
      }

      for (const model of models) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "model-row" + (model.current ? " current" : "");
        row.dataset.modelId = model.id;
        row.setAttribute("aria-label", (model.current ? "Current model " : "Use model ") + model.id + " for Codex");

        const line = document.createElement("span");
        line.className = "model-line";
        const name = document.createElement("span");
        name.className = "model-name";
        name.textContent = model.id;
        line.appendChild(name);
        if (model.current || model.recommended) {
          const badge = document.createElement("span");
          badge.className = "badge" + (!model.current && model.recommended ? " recommended" : "");
          badge.textContent = model.current ? "Current" : "Recommended";
          line.appendChild(badge);
        }

        const provider = document.createElement("span");
        provider.className = "model-provider";
        provider.textContent = model.provider + (model.vision ? " · vision" : "");

        const meta = document.createElement("span");
        meta.className = "model-meta";
        const context = document.createElement("span");
        context.textContent = model.context + " context";
        meta.appendChild(context);
        if (model.inputPrice || model.outputPrice) {
          const price = document.createElement("span");
          price.className = "model-price";
          price.textContent = "$" + formatPrice(model.inputPrice) + "/$" + formatPrice(model.outputPrice) + " per 1M";
          meta.appendChild(price);
        }
        row.append(line, provider, meta);
        elements.modelList.appendChild(row);
      }
    }

    function showNotice(message) {
      elements.notice.hidden = !message;
      elements.notice.textContent = message || "";
    }

    function submitLookup() {
      const code = elements.codeInput.value.trim();
      if (!code) return;
      showNotice("");
      vscode.postMessage({ type: "lookup", code: code });
    }

    document.addEventListener("click", function (event) {
      const seatButton = event.target.closest("[data-participant-id]");
      if (seatButton) {
        if (seatButton.disabled) return;
        showNotice("");
        vscode.postMessage({ type: "claim", code: lookupCode, participantId: seatButton.dataset.participantId });
        return;
      }
      const actionButton = event.target.closest("[data-action]");
      if (actionButton) {
        showNotice("");
        vscode.postMessage({ type: "command", action: actionButton.dataset.action });
        return;
      }
      const modelButton = event.target.closest("[data-model-id]");
      if (modelButton) {
        vscode.postMessage({ type: "selectModel", modelId: modelButton.dataset.modelId });
        return;
      }
      const linkButton = event.target.closest("[data-target]");
      if (linkButton) vscode.postMessage({ type: "openExternal", target: linkButton.dataset.target });
    });

    elements.lookupButton.addEventListener("click", submitLookup);
    elements.codeInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter") submitLookup();
    });
    elements.modelSearch.addEventListener("input", renderModels);
    elements.currentFilter.addEventListener("click", function () {
      currentOnly = !currentOnly;
      elements.currentFilter.setAttribute("aria-pressed", String(currentOnly));
      elements.currentFilter.textContent = currentOnly ? "All" : "Current";
      renderModels();
    });
    window.addEventListener("message", function (event) {
      const data = event.data;
      if (!data) return;
      if (data.type === "state") renderState(data.state);
      if (data.type === "team") renderSeats(data);
      if (data.type === "error") showNotice(data.message);
    });
    vscode.postMessage({ type: "ready" });
  </script>
</body>
</html>`;
}

function getNonce(): string {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let index = 0; index < 32; index += 1) {
    nonce += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return nonce;
}
