import { parse } from "smol-toml";

import { ROUTERPLEX_CODEX_ENV_KEY } from "./constants.js";

const MANAGED_START = "# >>> RouterPlex managed settings";
const MANAGED_END = "# <<< RouterPlex managed settings";
const ROOT_KEYS = new Set(["model", "model_provider"]);

export interface CodexProviderOptions {
  model: string;
  baseUrl: string;
}

export interface ConfigPatchResult {
  content: string;
  previousRootAssignments: string[];
}

function tableHeader(line: string): string | undefined {
  const match = line.match(/^\s*\[([^\]]+)]\s*(?:#.*)?$/);
  return match?.[1]?.trim();
}

function rootAssignmentKey(line: string): string | undefined {
  const match = line.match(/^\s*([A-Za-z0-9_-]+)\s*=/);
  return match?.[1];
}

function removeManagedBlock(lines: string[]): string[] {
  const result: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (line.trim() === MANAGED_START) {
      skipping = true;
      continue;
    }
    if (skipping && line.trim() === MANAGED_END) {
      skipping = false;
      continue;
    }
    if (!skipping) result.push(line);
  }
  return result;
}

function removeProviderTables(lines: string[]): string[] {
  const result: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const header = tableHeader(line);
    if (header !== undefined) {
      skipping = header === "model_providers.routerplex" || header.startsWith("model_providers.routerplex.");
    }
    if (!skipping) result.push(line);
  }
  return result;
}

function stripRootAssignments(lines: string[]): { lines: string[]; previous: string[] } {
  const result: string[] = [];
  const previous: string[] = [];
  let inRoot = true;
  for (const line of lines) {
    if (tableHeader(line) !== undefined) inRoot = false;
    const key = inRoot ? rootAssignmentKey(line) : undefined;
    if (key && ROOT_KEYS.has(key)) {
      previous.push(line);
      continue;
    }
    result.push(line);
  }
  return { lines: result, previous };
}

export function tomlString(value: string): string {
  return JSON.stringify(value);
}

function compactBlankLines(value: string): string {
  return value.replace(/\n{3,}/g, "\n\n").trim();
}

export function applyRouterPlexConfig(source: string, options: CodexProviderOptions): ConfigPatchResult {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const normalized = source.replace(/\r\n/g, "\n");
  const withoutManaged = removeManagedBlock(normalized.split("\n"));
  const withoutProvider = removeProviderTables(withoutManaged);
  const stripped = stripRootAssignments(withoutProvider);

  const rootBlock = [
    MANAGED_START,
    `model_provider = ${tomlString("routerplex")}`,
    `model = ${tomlString(options.model)}`,
    MANAGED_END,
  ].join("\n");

  const providerBlock = [
    "[model_providers.routerplex]",
    `name = ${tomlString("RouterPlex")}`,
    `base_url = ${tomlString(options.baseUrl)}`,
    `wire_api = ${tomlString("responses")}`,
    `env_key = ${tomlString(ROUTERPLEX_CODEX_ENV_KEY)}`,
    `env_key_instructions = ${tomlString(`Export ${ROUTERPLEX_CODEX_ENV_KEY} before starting VS Code or Codex.`)}`,
  ].join("\n");

  const body = compactBlankLines(stripped.lines.join("\n"));
  const content = `${rootBlock}\n\n${body ? `${body}\n\n` : ""}${providerBlock}\n`.replace(/\n/g, newline);
  parse(content);
  return { content, previousRootAssignments: stripped.previous };
}

export function removeRouterPlexConfig(source: string, previousRootAssignments: string[] = []): string {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const normalized = source.replace(/\r\n/g, "\n");
  const cleanedLines = removeProviderTables(removeManagedBlock(normalized.split("\n")));

  let inRoot = true;
  const currentRootKeys = new Set<string>();
  for (const line of cleanedLines) {
    if (tableHeader(line) !== undefined) inRoot = false;
    if (!inRoot) continue;
    const key = rootAssignmentKey(line);
    if (key) currentRootKeys.add(key);
  }

  const restorable = previousRootAssignments.filter((line) => {
    const key = rootAssignmentKey(line);
    return key !== undefined && !currentRootKeys.has(key);
  });
  const body = compactBlankLines(cleanedLines.join("\n"));
  const restored = [restorable.join("\n"), body].filter(Boolean).join("\n\n");
  const content = restored ? `${restored}\n` : "";
  if (content) parse(content);
  return content.replace(/\n/g, newline);
}
