import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as vscode from "vscode";

import { ROUTERPLEX_CODEX_ENV_KEY } from "./constants.js";
import { applyManagedEnvironment, removeManagedEnvironment, type ShellSyntax } from "./environmentConfig.js";

export interface EnvironmentExportResult {
  description: string;
  profilePath?: string;
}

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

function detectedProfile(): { profilePath: string; syntax: ShellSyntax } {
  const configured = vscode.workspace.getConfiguration("routerplex").get<string>("shellProfile", "").trim();
  if (configured) {
    const profilePath = expandHome(configured);
    if (!path.isAbsolute(profilePath)) throw new Error("Shell Profile must be an absolute path.");
    return { profilePath, syntax: profilePath.endsWith("config.fish") ? "fish" : "posix" };
  }

  const shell = path.basename(process.env.SHELL || "").toLowerCase();
  if (shell === "fish") return { profilePath: path.join(os.homedir(), ".config", "fish", "config.fish"), syntax: "fish" };
  if (shell === "zsh" || (process.platform === "darwin" && !shell)) {
    return { profilePath: path.join(os.homedir(), ".zshrc"), syntax: "posix" };
  }
  if (shell === "bash" || !shell) return { profilePath: path.join(os.homedir(), ".bashrc"), syntax: "posix" };
  return { profilePath: path.join(os.homedir(), ".profile"), syntax: "posix" };
}

function applyRuntimeEnvironment(context: vscode.ExtensionContext, apiKey: string): void {
  process.env[ROUTERPLEX_CODEX_ENV_KEY] = apiKey;
  context.environmentVariableCollection.persistent = true;
  context.environmentVariableCollection.description = "RouterPlex API key for Codex and integrated terminals";
  context.environmentVariableCollection.replace(ROUTERPLEX_CODEX_ENV_KEY, apiKey, {
    applyAtProcessCreation: true,
    applyAtShellIntegration: true,
  });
}

async function setWindowsUserEnvironment(apiKey: string | undefined): Promise<void> {
  const script = apiKey === undefined
    ? `[Environment]::SetEnvironmentVariable(${JSON.stringify(ROUTERPLEX_CODEX_ENV_KEY)}, $null, "User")`
    : [
        "$value = [Console]::In.ReadToEnd().Trim()",
        `[Environment]::SetEnvironmentVariable(${JSON.stringify(ROUTERPLEX_CODEX_ENV_KEY)}, $value, "User")`,
      ].join("; ");

  await new Promise<void>((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      stdio: ["pipe", "ignore", "pipe"],
      windowsHide: true,
    });
    let errorOutput = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      errorOutput += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(errorOutput.trim() || `PowerShell environment update failed with exit code ${code}.`));
    });
    child.stdin.end(apiKey ?? "");
  });
}

export function restoreRuntimeEnvironment(context: vscode.ExtensionContext, apiKey: string): void {
  applyRuntimeEnvironment(context, apiKey);
}

export async function persistCodexEnvironment(
  context: vscode.ExtensionContext,
  apiKey: string,
  existingProfilePath?: string,
): Promise<EnvironmentExportResult> {
  applyRuntimeEnvironment(context, apiKey);

  if (process.platform === "win32") {
    await setWindowsUserEnvironment(apiKey);
    return { description: "Windows user environment" };
  }

  const detected = detectedProfile();
  const profilePath = existingProfilePath || detected.profilePath;
  const syntax: ShellSyntax = profilePath.endsWith("config.fish") ? "fish" : "posix";
  const source = await readOptional(profilePath);
  await mkdir(path.dirname(profilePath), { recursive: true });
  await writeFile(profilePath, applyManagedEnvironment(source, ROUTERPLEX_CODEX_ENV_KEY, apiKey, syntax), "utf8");
  return { description: profilePath, profilePath };
}

export async function removeCodexEnvironment(
  context: vscode.ExtensionContext,
  profilePath: string | undefined,
  previousValue: string | null | undefined,
): Promise<void> {
  context.environmentVariableCollection.delete(ROUTERPLEX_CODEX_ENV_KEY);
  if (previousValue !== null && previousValue !== undefined) process.env[ROUTERPLEX_CODEX_ENV_KEY] = previousValue;
  else delete process.env[ROUTERPLEX_CODEX_ENV_KEY];

  if (process.platform === "win32") {
    await setWindowsUserEnvironment(previousValue ?? undefined);
    return;
  }

  const target = profilePath || detectedProfile().profilePath;
  const source = await readOptional(target);
  if (source) await writeFile(target, removeManagedEnvironment(source), "utf8");
}
