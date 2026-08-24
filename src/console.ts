// Talks to the hackathon console: redeem a team code, then read live credit.
import { DEFAULT_CONSOLE_URL } from "./constants.js";

export interface TeamSeat {
  id: string;
  name: string;
  claimed: boolean;
  ready: boolean;
}

export interface ChallengeIdea {
  id: string;
  number: number;
  title: string;
  brief: string;
  angle?: string;
}

export interface TeamLookup {
  team: { id: string; name: string; idea: ChallengeIdea | null };
  members: TeamSeat[];
}

export interface ClaimResult {
  apiKey: string;
  baseUrl: string;
  member: { id: string; name: string; budget: number };
  team: { name: string; budget: number; idea: ChallengeIdea | null };
  models: string[];
}

export interface Credit {
  member: { name: string; spend: number; budget: number };
  team: { name: string; spend: number; budget: number; idea?: ChallengeIdea | null };
  at: string;
}

export class ConsoleError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ConsoleError";
  }
}

export function normalizeConsoleUrl(value: string | undefined): string {
  const trimmed = (value || "").trim().replace(/\/+$/, "");
  return trimmed || DEFAULT_CONSOLE_URL;
}

async function call<T>(consoleUrl: string, path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${normalizeConsoleUrl(consoleUrl)}${path}`, {
      ...init,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new ConsoleError(`Cannot reach the hackathon console. Check the venue network. (${String(error)})`, 0);
  }
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message =
      (body as { error?: string } | null)?.error || `The hackathon console returned HTTP ${response.status}.`;
    throw new ConsoleError(message, response.status);
  }
  return body as T;
}

export function lookupTeam(consoleUrl: string, code: string): Promise<TeamLookup> {
  return call<TeamLookup>(consoleUrl, "/api/public/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
}

export function claimSeat(consoleUrl: string, code: string, participantId: string): Promise<ClaimResult> {
  return call<ClaimResult>(consoleUrl, "/api/public/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, participantId }),
  });
}

export function fetchCredit(consoleUrl: string, apiKey: string): Promise<Credit> {
  return call<Credit>(consoleUrl, "/api/public/me", {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

export interface PublicConfig {
  baseUrl: string;
  models: string[];
}

export function fetchConfig(consoleUrl: string): Promise<PublicConfig> {
  return call<PublicConfig>(consoleUrl, "/api/public/config", { method: "GET" });
}
