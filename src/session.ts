import * as vscode from "vscode";

import { updateClaudeConfiguration } from "./claude.js";
import { updateCodexEnvironment } from "./codex.js";
import {
  CLAUDE_MANAGED_STATE_KEY,
  CODEX_MANAGED_STATE_KEY,
  DEFAULT_API_BASE_URL,
  OPENCODE_MANAGED_STATE_KEY,
  SESSION_SECRET_KEY,
} from "./constants.js";
import { claimSeat, fetchConfig, lookupTeam, normalizeConsoleUrl, type ChallengeIdea } from "./console.js";
import { restoreRuntimeEnvironment } from "./environment.js";
import { fallbackModels } from "./models.js";
import { updateOpenCodeConfiguration } from "./opencode.js";
import type { ApiKeySource } from "./provider.js";

export interface HackathonSession {
  apiKey: string;
  baseUrl: string;
  consoleUrl: string;
  participantId: string;
  memberName: string;
  teamName: string;
  teamCode: string;
  models: string[];
  idea: ChallengeIdea | null;
  joinedAt: string;
}

/**
 * The seat a participant claimed. The key lives in SecretStorage, never in
 * settings.json and never in the workspace.
 */
export class SessionStore implements ApiKeySource {
  private cached: HackathonSession | null | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly onDidChange: () => void,
  ) {}

  async get(): Promise<HackathonSession | null> {
    if (this.cached !== undefined) return this.cached;
    const raw = await this.context.secrets.get(SESSION_SECRET_KEY);
    if (!raw) {
      this.cached = null;
      return null;
    }
    try {
      this.cached = JSON.parse(raw) as HackathonSession;
    } catch {
      this.cached = null;
    }
    return this.cached;
  }

  async getOrPrompt(): Promise<string | undefined> {
    const existing = await this.get();
    if (existing) return existing.apiKey;
    return (await this.join())?.apiKey;
  }

  async apiKey(): Promise<string | undefined> {
    return (await this.get())?.apiKey;
  }

  async baseUrl(): Promise<string> {
    return (await this.get())?.baseUrl ?? DEFAULT_API_BASE_URL;
  }

  consoleUrl(): string {
    return normalizeConsoleUrl(
      vscode.workspace.getConfiguration("routerplexHackathon").get<string>("consoleUrl", ""),
    );
  }

  async restoreEnvironment(): Promise<void> {
    if (!this.context.globalState.get<boolean>(CODEX_MANAGED_STATE_KEY, false)) return;
    const apiKey = await this.apiKey();
    if (apiKey) restoreRuntimeEnvironment(this.context, apiKey);
  }

  /** Team code, then the seat picker, then the key. Same three steps as the panel. */
  async join(): Promise<HackathonSession | undefined> {
    const consoleUrl = this.consoleUrl();
    const code = await vscode.window.showInputBox({
      title: "Join the hackathon",
      prompt: "Enter your team code",
      ignoreFocusOut: true,
      placeHolder: "ABC-234",
      validateInput: (value) => (value.trim().length < 4 ? "Team codes look like ABC-234." : undefined),
    });
    if (!code) return undefined;

    const found = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Checking your team code" },
      () => lookupTeam(consoleUrl, code.trim()),
    );

    const seat = await vscode.window.showQuickPick(
      found.members.map((member) => ({
        label: member.name,
        description: member.claimed ? "Already claimed on another machine" : undefined,
        detail: member.ready ? undefined : "No key issued yet - ask the organiser to provision",
        id: member.id,
      })),
      { title: `Who are you on ${found.team.name}?`, placeHolder: "Pick your name", ignoreFocusOut: true },
    );
    if (!seat) return undefined;

    return this.claim(code.trim(), seat.id);
  }

  async claim(code: string, participantId: string): Promise<HackathonSession> {
    const consoleUrl = this.consoleUrl();
    const result = await claimSeat(consoleUrl, code, participantId);
    const session: HackathonSession = {
      apiKey: result.apiKey,
      baseUrl: (result.baseUrl || DEFAULT_API_BASE_URL).replace(/\/+$/, ""),
      consoleUrl,
      participantId: result.member.id,
      memberName: result.member.name,
      teamName: result.team.name,
      teamCode: code.toUpperCase(),
      models: result.models,
      idea: result.team.idea ?? null,
      joinedAt: new Date().toISOString(),
    };
    await this.set(session);
    await this.updateOptedInTools(session);
    return session;
  }

  /** Re-reads the roster the console hands out, so a new model appears without rejoining. */
  async refreshRoster(): Promise<boolean> {
    const session = await this.get();
    if (!session) return false;
    const config = await fetchConfig(session.consoleUrl || this.consoleUrl());
    const changed =
      JSON.stringify(config.models) !== JSON.stringify(session.models) ||
      (config.baseUrl && config.baseUrl.replace(/\/+$/, "") !== session.baseUrl);
    if (!changed) return false;
    const refreshed = {
      ...session,
      models: config.models,
      baseUrl: (config.baseUrl || session.baseUrl).replace(/\/+$/, ""),
    };
    await this.set(refreshed);
    await this.updateOptedInTools(refreshed);
    return true;
  }


  /** The organiser can deal or change a team's idea after people have joined. */
  async noteIdea(idea: ChallengeIdea | null | undefined): Promise<void> {
    const session = await this.get();
    if (!session || idea === undefined) return;
    if (JSON.stringify(session.idea ?? null) === JSON.stringify(idea ?? null)) return;
    await this.set({ ...session, idea: idea ?? null });
  }

  async set(session: HackathonSession): Promise<void> {
    this.cached = session;
    await this.context.secrets.store(SESSION_SECRET_KEY, JSON.stringify(session));
    this.onDidChange();
  }

  async clear(): Promise<void> {
    this.cached = null;
    await this.context.secrets.delete(SESSION_SECRET_KEY);
    this.onDidChange();
  }

  private async updateOptedInTools(session: HackathonSession): Promise<void> {
    const models = fallbackModels(session.models);
    const updates: Promise<void>[] = [updateCodexEnvironment(this.context, session.apiKey)];
    if (this.context.globalState.get<boolean>(OPENCODE_MANAGED_STATE_KEY, false)) {
      updates.push(updateOpenCodeConfiguration(this.context, session.apiKey, models, session.baseUrl));
    }
    if (this.context.globalState.get<boolean>(CLAUDE_MANAGED_STATE_KEY, false)) {
      updates.push(updateClaudeConfiguration(this.context, session.apiKey, models, session.baseUrl));
    }
    await Promise.all(updates);
  }
}
