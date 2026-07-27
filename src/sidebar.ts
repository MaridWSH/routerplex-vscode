import * as vscode from "vscode";

import {
  CODEX_LAST_BACKUP_STATE_KEY,
  CODEX_LAST_MODEL_STATE_KEY,
  CODEX_MANAGED_STATE_KEY,
  DEFAULT_CODEX_MODEL,
} from "./constants.js";
import type { CredentialManager } from "./credentials.js";
import { displayName, type RouterPlexModel } from "./models.js";
import type { RouterPlexLanguageModelProvider } from "./provider.js";

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

interface PanelState {
  hasApiKey: boolean;
  codexManaged: boolean;
  currentModel: string;
  hasBackup: boolean;
  models: PanelModel[];
}

interface PanelMessage {
  type?: unknown;
  action?: unknown;
  modelId?: unknown;
  target?: unknown;
}

const COMMANDS: Record<string, string> = {
  setup: "routerplex.setup",
  configureApiKey: "routerplex.configureApiKey",
  configureCodex: "routerplex.configureCodex",
  testConnection: "routerplex.testConnection",
  refreshModels: "routerplex.refreshModels",
  checkForUpdates: "routerplex.checkForUpdates",
  openCodexConfig: "routerplex.openCodexConfig",
  openSettings: "routerplex.openSettings",
  removeConfiguration: "routerplex.removeConfiguration",
};

const EXTERNAL_LINKS: Record<string, string> = {
  docs: "https://docs.routerplex.com/",
  keys: "https://routerplex.com/dashboard/keys",
  models: "https://routerplex.com/models",
};

export class RouterPlexPanelProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private revision = 0;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly credentials: CredentialManager,
    private readonly provider: RouterPlexLanguageModelProvider,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = panelHtml(view.webview);

    this.disposables.push(
      view.webview.onDidReceiveMessage((message: PanelMessage) => this.handleMessage(message)),
      view.onDidChangeVisibility(() => {
        if (view.visible) void this.refresh();
      }),
      view.onDidDispose(() => {
        if (this.view === view) this.view = undefined;
      }),
    );
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const view = this.view;
    if (!view) return;
    const revision = ++this.revision;
    const state = await this.panelState();
    if (this.view !== view || revision !== this.revision) return;
    await view.webview.postMessage({ type: "state", state });
  }

  dispose(): void {
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
  }

  private async panelState(): Promise<PanelState> {
    const hasApiKey = Boolean(await this.credentials.get());
    const codexManaged = this.context.globalState.get<boolean>(CODEX_MANAGED_STATE_KEY, false);
    const currentModel = this.context.globalState.get<string>(CODEX_LAST_MODEL_STATE_KEY, DEFAULT_CODEX_MODEL);
    const hasBackup = Boolean(this.context.globalState.get<string>(CODEX_LAST_BACKUP_STATE_KEY, ""));
    const models = await this.provider.listModels(false);
    return {
      hasApiKey,
      codexManaged,
      currentModel,
      hasBackup,
      models: models.map((model) => panelModel(model, codexManaged, currentModel)),
    };
  }

  private async handleMessage(message: PanelMessage): Promise<void> {
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

    if (message.type === "selectModel" && typeof message.modelId === "string") {
      const models = await this.provider.listModels(false);
      if (!models.some((model) => model.id === message.modelId)) return;
      await vscode.commands.executeCommand("routerplex.configureCodexModel", message.modelId);
      await this.refresh();
      return;
    }

    if (message.type === "openExternal" && typeof message.target === "string") {
      const target = EXTERNAL_LINKS[message.target];
      if (target) await vscode.env.openExternal(vscode.Uri.parse(target));
    }
  }
}

function panelModel(model: RouterPlexModel, codexManaged: boolean, currentModel: string): PanelModel {
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
  <title>RouterPlex Control Panel</title>
  <style nonce="${nonce}">
    :root {
      color-scheme: dark;
      --rp-bg: #0b0b0a;
      --rp-sidebar: #0e0e0d;
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
    .eyebrow {
      color: var(--rp-faint);
      font: 9px/1.2 var(--rp-mono);
      text-transform: uppercase;
    }
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

    .primary-button, .secondary-button, .action-button, .utility-button, .model-row, .link-button {
      cursor: pointer;
      transition: border-color 140ms ease, background-color 140ms ease, color 140ms ease, transform 140ms ease;
    }
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

    .models-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px; margin-bottom: 8px; }
    .search-input {
      min-width: 0;
      height: 32px;
      padding: 0 10px;
      border: 1px solid var(--rp-border);
      border-radius: 6px;
      color: var(--rp-text);
      background: rgba(19, 19, 17, 0.94);
      font-size: 11px;
    }
    .search-input::placeholder { color: var(--rp-faint); }
    .secondary-button {
      height: 32px;
      padding: 0 10px;
      border: 1px solid var(--rp-border);
      border-radius: 6px;
      color: var(--rp-muted);
      background: var(--rp-panel);
      font-size: 10.5px;
    }
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
      .models-toolbar { grid-template-columns: 1fr; }
    }
    @media (prefers-reduced-motion: reduce) {
      .primary-button, .secondary-button, .action-button, .utility-button, .model-row, .link-button { transition: none; }
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
        <div class="brand-label">Control plane</div>
      </div>
      <div class="brand-live"><span id="brandDot" class="status-dot"></span><span id="brandStatus">Loading</span></div>
    </header>

    <div id="loading" class="loading">Loading RouterPlex state...</div>
    <div id="content" class="content" hidden>
      <section class="hero">
        <div class="hero-main">
          <div id="heroState" class="hero-state"><span class="status-dot"></span><span id="heroStateText">Setup required</span></div>
          <h1 id="heroTitle">Finish setup</h1>
          <p id="heroCopy" class="hero-copy">Connect your RouterPlex key and choose a Codex model.</p>
          <div id="heroModel" class="hero-model">No Codex model selected</div>
          <button id="heroAction" class="primary-button" type="button" data-action="setup">Run setup</button>
        </div>
        <div class="hero-footer">
          <div class="status-cell"><div class="eyebrow">API key</div><div id="keyStatus" class="status-value">Missing</div></div>
          <div class="status-cell"><div class="eyebrow">Codex</div><div id="codexStatus" class="status-value">Not configured</div></div>
        </div>
      </section>

      <section>
        <div class="section-heading"><div class="section-title">Quick actions</div></div>
        <div class="action-grid">
          <button class="action-button" type="button" data-action="configureApiKey"><span class="action-kicker">Access</span><span class="action-title">API key</span><span id="keyActionDetail" class="action-detail">Add secure key</span></button>
          <button class="action-button" type="button" data-action="configureCodex"><span class="action-kicker">Codex</span><span class="action-title">Choose model</span><span id="codexActionDetail" class="action-detail">Configure provider</span></button>
          <button class="action-button" type="button" data-action="testConnection"><span class="action-kicker">Gateway</span><span class="action-title">Test connection</span><span class="action-detail">Validate credentials</span></button>
          <button class="action-button" type="button" data-action="refreshModels"><span class="action-kicker">Catalog</span><span class="action-title">Refresh models</span><span class="action-detail">Fetch latest list</span></button>
        </div>
      </section>

      <section>
        <div class="section-heading">
          <div class="section-title">Codex models</div>
          <div id="modelCount" class="section-count">0 models</div>
        </div>
        <div class="models-toolbar">
          <input id="modelSearch" class="search-input" type="search" placeholder="Search models" aria-label="Search RouterPlex models">
          <button id="currentFilter" class="secondary-button" type="button" aria-pressed="false">Current</button>
        </div>
        <div id="modelList" class="model-list"></div>
      </section>

      <section>
        <div class="section-heading"><div class="section-title">Utilities</div></div>
        <div class="utilities">
          <button class="utility-button" type="button" data-action="checkForUpdates">Check for extension updates<span class="utility-arrow">›</span></button>
          <button class="utility-button" type="button" data-action="openCodexConfig">Open Codex configuration<span id="backupLabel" class="utility-arrow"></span></button>
          <button class="utility-button" type="button" data-action="openSettings">RouterPlex settings<span class="utility-arrow">›</span></button>
          <button id="removeButton" class="utility-button danger" type="button" data-action="removeConfiguration">Remove configuration<span class="utility-arrow">›</span></button>
        </div>
      </section>

      <nav class="footer-links" aria-label="RouterPlex links">
        <button class="link-button" type="button" data-target="docs">Docs</button>
        <button class="link-button" type="button" data-target="keys">API keys</button>
        <button class="link-button" type="button" data-target="models">Models</button>
      </nav>
    </div>
  </main>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let panelState = null;
    let currentOnly = false;

    const elements = {
      loading: document.getElementById("loading"),
      content: document.getElementById("content"),
      brandDot: document.getElementById("brandDot"),
      brandStatus: document.getElementById("brandStatus"),
      heroState: document.getElementById("heroState"),
      heroStateText: document.getElementById("heroStateText"),
      heroTitle: document.getElementById("heroTitle"),
      heroCopy: document.getElementById("heroCopy"),
      heroModel: document.getElementById("heroModel"),
      heroAction: document.getElementById("heroAction"),
      keyStatus: document.getElementById("keyStatus"),
      codexStatus: document.getElementById("codexStatus"),
      keyActionDetail: document.getElementById("keyActionDetail"),
      codexActionDetail: document.getElementById("codexActionDetail"),
      modelCount: document.getElementById("modelCount"),
      modelSearch: document.getElementById("modelSearch"),
      currentFilter: document.getElementById("currentFilter"),
      modelList: document.getElementById("modelList"),
      backupLabel: document.getElementById("backupLabel"),
      removeButton: document.getElementById("removeButton"),
    };

    function setText(element, value) {
      if (element) element.textContent = value;
    }

    function formatPrice(value) {
      return Number.isInteger(value) ? String(value) : String(value).replace(/0+$/, "").replace(/\.$/, "");
    }

    function renderState(state) {
      panelState = state;
      const ready = state.hasApiKey && state.codexManaged;
      elements.loading.hidden = true;
      elements.content.hidden = false;
      elements.brandDot.classList.toggle("ready", ready);
      setText(elements.brandStatus, ready ? "Ready" : "Setup");
      elements.heroState.classList.toggle("ready", ready);
      setText(elements.heroStateText, ready ? "Configured" : "Setup required");
      setText(elements.heroTitle, ready ? "Ready to route" : "Finish setup");
      setText(elements.heroCopy, ready
        ? "RouterPlex is configured for VS Code Chat and Codex."
        : "Connect your API key and choose a Codex model.");
      setText(elements.heroModel, state.codexManaged ? state.currentModel : "No Codex model selected");
      setText(elements.heroAction, ready ? "Test connection" : "Run setup");
      elements.heroAction.dataset.action = ready ? "testConnection" : "setup";
      setText(elements.keyStatus, state.hasApiKey ? "Configured" : "Missing");
      setText(elements.codexStatus, state.codexManaged ? "Configured" : "Not configured");
      setText(elements.keyActionDetail, state.hasApiKey ? "Replace secure key" : "Add secure key");
      setText(elements.codexActionDetail, state.codexManaged ? state.currentModel : "Configure provider");
      setText(elements.modelCount, state.models.length + (state.models.length === 1 ? " model" : " models"));
      setText(elements.backupLabel, state.hasBackup ? "Backup available" : "›");
      elements.removeButton.hidden = !state.hasApiKey && !state.codexManaged;
      renderModels();
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
        empty.textContent = currentOnly ? "No active Codex model yet." : "No models match this search.";
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
        const price = document.createElement("span");
        price.className = "model-price";
        price.textContent = "$" + formatPrice(model.inputPrice) + "/$" + formatPrice(model.outputPrice) + " per 1M";
        meta.append(context, price);
        row.append(line, provider, meta);
        elements.modelList.appendChild(row);
      }
    }

    document.addEventListener("click", function (event) {
      const actionButton = event.target.closest("[data-action]");
      if (actionButton) {
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

    elements.modelSearch.addEventListener("input", renderModels);
    elements.currentFilter.addEventListener("click", function () {
      currentOnly = !currentOnly;
      elements.currentFilter.setAttribute("aria-pressed", String(currentOnly));
      elements.currentFilter.textContent = currentOnly ? "All" : "Current";
      renderModels();
    });
    window.addEventListener("message", function (event) {
      if (event.data && event.data.type === "state") renderState(event.data.state);
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
