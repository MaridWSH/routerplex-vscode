import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as vscode from "vscode";

import { normalizeBaseUrl } from "./api.js";
import { applyRouterPlexConfig, removeRouterPlexConfig } from "./codexConfig.js";
import {
  CODEX_LAST_BACKUP_STATE_KEY,
  CODEX_LAST_MODEL_STATE_KEY,
  CODEX_MANAGED_STATE_KEY,
  CODEX_PREVIOUS_ROOT_STATE_KEY,
} from "./constants.js";
import { removeCredentialHelper, writeCredentialHelper } from "./credentialHelper.js";

const CONFIG_FILE = "config.toml";

async function readOptional(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith(`~${path.sep}`)) return path.join(os.homedir(), value.slice(2));
  return value;
}

export function resolveCodexHome(): string {
  const configured = vscode.workspace.getConfiguration("routerplex").get<string>("codexHome", "").trim();
  const candidate = expandHome(configured || process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
  if (!path.isAbsolute(candidate)) {
    throw new Error("Codex Home must be an absolute path.");
  }
  return path.normalize(candidate);
}

export function codexConfigPath(): string {
  return path.join(resolveCodexHome(), CONFIG_FILE);
}

function credentialStoragePath(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, "codex-auth");
}

async function backupConfig(context: vscode.ExtensionContext, source: string): Promise<string> {
  const backupDirectory = path.join(context.globalStorageUri.fsPath, "backups");
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDirectory, `config-${timestamp}.toml`);
  await writeFile(backupPath, source, { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") await chmod(backupPath, 0o600);
  await context.globalState.update(CODEX_LAST_BACKUP_STATE_KEY, backupPath);
  return backupPath;
}

async function writeConfig(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await writeFile(filePath, content, { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") await chmod(filePath, 0o600);
}

export async function configureCodex(
  context: vscode.ExtensionContext,
  apiKey: string,
  model: string,
  baseUrl: string,
): Promise<{ configPath: string; backupPath: string }> {
  if (context.globalStorageUri.scheme !== "file") {
    throw new Error("Codex configuration requires a file-backed VS Code extension host.");
  }

  const configPath = codexConfigPath();
  const source = await readOptional(configPath);
  const backupPath = await backupConfig(context, source);
  const auth = await writeCredentialHelper(credentialStoragePath(context), apiKey);
  const patch = applyRouterPlexConfig(source, {
    model,
    baseUrl: normalizeBaseUrl(baseUrl),
    authCommand: auth.command,
    authArgs: auth.args,
  });

  const alreadyManaged = context.globalState.get<boolean>(CODEX_MANAGED_STATE_KEY, false);
  if (!alreadyManaged) {
    await context.globalState.update(CODEX_PREVIOUS_ROOT_STATE_KEY, patch.previousRootAssignments);
  }
  await writeConfig(configPath, patch.content);
  await context.globalState.update(CODEX_MANAGED_STATE_KEY, true);
  await context.globalState.update(CODEX_LAST_MODEL_STATE_KEY, model);
  return { configPath, backupPath };
}

export async function updateCodexCredential(context: vscode.ExtensionContext, apiKey: string): Promise<void> {
  if (!context.globalState.get<boolean>(CODEX_MANAGED_STATE_KEY, false)) return;
  await writeCredentialHelper(credentialStoragePath(context), apiKey);
}

export async function removeCodexConfiguration(
  context: vscode.ExtensionContext,
): Promise<{ configPath: string; backupPath?: string }> {
  const configPath = codexConfigPath();
  const source = await readOptional(configPath);
  let backupPath: string | undefined;
  if (source) {
    backupPath = await backupConfig(context, source);
    const previous = context.globalState.get<string[]>(CODEX_PREVIOUS_ROOT_STATE_KEY, []);
    await writeConfig(configPath, removeRouterPlexConfig(source, previous));
  }

  await removeCredentialHelper(credentialStoragePath(context));
  await context.globalState.update(CODEX_MANAGED_STATE_KEY, false);
  await context.globalState.update(CODEX_PREVIOUS_ROOT_STATE_KEY, undefined);
  await context.globalState.update(CODEX_LAST_MODEL_STATE_KEY, undefined);
  return { configPath, ...(backupPath ? { backupPath } : {}) };
}

export async function openCodexConfiguration(): Promise<void> {
  const configPath = codexConfigPath();
  await mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  const source = await readOptional(configPath);
  if (!source) await writeConfig(configPath, "");
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(configPath));
  await vscode.window.showTextDocument(document);
}
