import * as vscode from "vscode";

import { isNewerVersion, parseHackathonRelease, type ExtensionRelease } from "./updateInfo.js";

const LATEST_RELEASE_URL = "https://api.github.com/repos/MaridWSH/routerplex-vscode/releases?per_page=30";
const LAST_UPDATE_CHECK_STATE_KEY = "routerplex.hackathon.update.lastCheck";
const INSTALLED_UPDATE_STATE_KEY = "routerplex.hackathon.update.installedVersion";
const DEFAULT_UPDATE_CHECK_INTERVAL_HOURS = 6;
const STARTUP_CHECK_DELAY_MS = 15 * 1000;
const MAX_VSIX_BYTES = 25 * 1024 * 1024;

export class ExtensionUpdateService implements vscode.Disposable {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | undefined;
  private readonly configurationSubscription: vscode.Disposable;
  private disposed = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.configurationSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("routerplexHackathon.autoUpdate") || event.affectsConfiguration("routerplexHackathon.updateCheckIntervalHours")) {
        this.schedule(true);
      }
    });
  }

  start(): void {
    this.schedule(true);
  }

  async check(interactive = false): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.performCheck(interactive);
    try {
      await this.inFlight;
    } finally {
      this.inFlight = undefined;
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.configurationSubscription.dispose();
  }

  private schedule(initial: boolean): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.disposed || !this.configuration().get<boolean>("autoUpdate", true)) return;

    const interval = this.updateIntervalMs();
    const lastCheck = this.context.globalState.get<number>(LAST_UPDATE_CHECK_STATE_KEY, 0);
    const remaining = Math.max(0, interval - (Date.now() - lastCheck));
    const delay = initial ? Math.max(STARTUP_CHECK_DELAY_MS, remaining) : interval;
    this.timer = setTimeout(() => {
      void this.check(false).finally(() => this.schedule(false));
    }, delay);
  }

  private configuration(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration("routerplexHackathon");
  }

  private updateIntervalMs(): number {
    const hours = this.configuration().get<number>("updateCheckIntervalHours", DEFAULT_UPDATE_CHECK_INTERVAL_HOURS);
    return Math.max(1, hours) * 60 * 60 * 1000;
  }

  private async performCheck(interactive: boolean): Promise<void> {
    try {
      const release = await this.latestRelease();
      await this.context.globalState.update(LAST_UPDATE_CHECK_STATE_KEY, Date.now());
      const currentVersion = String(this.context.extension.packageJSON.version);

      if (!isNewerVersion(release.version, currentVersion)) {
        if (interactive) await vscode.window.showInformationMessage(`RouterPlex Hackathon ${currentVersion} is up to date.`);
        return;
      }

      if (this.context.globalState.get<string>(INSTALLED_UPDATE_STATE_KEY) === release.version) {
        if (interactive) await this.showReloadMessage(release);
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Installing RouterPlex Hackathon ${release.version}`,
        },
        () => this.downloadAndInstall(release),
      );
      await this.context.globalState.update(INSTALLED_UPDATE_STATE_KEY, release.version);
      await this.showReloadMessage(release);
    } catch (error) {
      await this.context.globalState.update(LAST_UPDATE_CHECK_STATE_KEY, Date.now());
      if (interactive) throw error;
    }
  }

  private async latestRelease(): Promise<ExtensionRelease> {
    const currentVersion = String(this.context.extension.packageJSON.version);
    const response = await fetch(LATEST_RELEASE_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `routerplex-hackathon-extension/${currentVersion}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`GitHub update check returned HTTP ${response.status}.`);
    return parseHackathonRelease(await response.json());
  }

  private async downloadAndInstall(release: ExtensionRelease): Promise<void> {
    const response = await fetch(release.downloadUrl, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Hackathon update download returned HTTP ${response.status}.`);

    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_VSIX_BYTES) throw new Error("The hackathon update is unexpectedly large.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_VSIX_BYTES) throw new Error("The hackathon update is unexpectedly large.");

    const updateDirectory = vscode.Uri.joinPath(this.context.globalStorageUri, "updates");
    const vsixUri = vscode.Uri.joinPath(updateDirectory, release.assetName);
    await vscode.workspace.fs.createDirectory(updateDirectory);
    await vscode.workspace.fs.writeFile(vsixUri, bytes);
    await vscode.commands.executeCommand("workbench.extensions.installExtension", vsixUri);
  }

  private async showReloadMessage(release: ExtensionRelease): Promise<void> {
    const action = await vscode.window.showInformationMessage(
      `RouterPlex Hackathon ${release.version} is installed. Reload VS Code to use it.`,
      "Reload VS Code",
      "View Release",
    );
    if (action === "Reload VS Code") await vscode.commands.executeCommand("workbench.action.reloadWindow");
    if (action === "View Release") await vscode.env.openExternal(vscode.Uri.parse(release.releaseUrl));
  }
}
