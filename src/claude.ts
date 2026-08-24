import { execFile } from "node:child_process";
import { readdir, stat, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";

import {
  CLAUDE_MANAGED_STATE_KEY,
  CLAUDE_PREVIOUS_SECRET_KEY,
} from "./constants.js";
import {
  CLAUDE_DESKTOP_PROFILE_ID,
  applyClaudeCodeSettings,
  applyClaudeDesktopMeta,
  applyDeploymentMode,
  buildClaudeDesktopProfile,
  captureClaudeCodePrevious,
  captureDeploymentMode,
  claudeCodeSettingsPath,
  resolveClaudeDesktopCandidates,
  restoreClaudeCodeSettings,
  restoreDeploymentMode,
  storedValue,
  type StoredValue,
} from "./claudeConfig.js";
import {
  backupExistingFile,
  isJsonObject,
  parseJsonObject,
  readOptional,
  setJsoncValues,
  writePrivateFile,
  type JsonObject,
} from "./jsonConfig.js";
import type { HackathonModel } from "./models.js";

const execFileAsync = promisify(execFile);

interface NormalPrevious {
  path: string;
  deploymentMode: StoredValue;
}

interface ThirdPartyPrevious {
  root: string;
  deploymentMode: StoredValue;
  entry: StoredValue;
  appliedId: StoredValue;
  profile: StoredValue;
}

interface ClaudePrevious {
  code: ReturnType<typeof captureClaudeCodePrevious>;
  normal: NormalPrevious[];
  thirdParty: ThirdPartyPrevious[];
}

export interface ClaudeConfigurationResult {
  changedFiles: string[];
  backups: string[];
}

export async function ensureClaudeDesktopStopped(platform: NodeJS.Platform = process.platform): Promise<void> {
  if (platform !== "win32" && platform !== "darwin") {
    throw new Error("Claude Desktop setup is supported on Windows and macOS.");
  }
  try {
    if (platform === "win32") {
      const { stdout } = await execFileAsync("tasklist.exe", ["/FI", "IMAGENAME eq Claude.exe", "/FO", "CSV", "/NH"]);
      if (/"Claude\.exe"/i.test(stdout)) throw new Error("running");
    } else {
      await execFileAsync("pgrep", ["-x", "Claude"]);
      throw new Error("running");
    }
  } catch (error) {
    if (error instanceof Error && error.message === "running") {
      throw new Error("Fully quit Claude Desktop before configuring it, then try again.");
    }
    const code = (error as { code?: unknown }).code;
    if (code !== 1 && code !== "ENOENT") throw error;
  }
}

export async function configureClaude(
  context: vscode.ExtensionContext,
  apiKey: string,
  models: readonly HackathonModel[],
  baseUrl: string,
): Promise<ClaudeConfigurationResult> {
  const home = os.homedir();
  const codePath = claudeCodeSettingsPath(home);
  const roots = await resolveDesktopRoots(process.platform, home);
  const codeSource = await readOptional(codePath);
  const normalSources = await Promise.all(
    roots.normal.map(async (root) => {
      const filePath = path.join(root, "claude_desktop_config.json");
      return { path: filePath, source: await readOptional(filePath) };
    }),
  );
  const thirdPartySources = await Promise.all(
    roots.thirdParty.map(async (root) => {
      const metaPath = path.join(root, "configLibrary", "_meta.json");
      const profilePath = path.join(root, "configLibrary", `${CLAUDE_DESKTOP_PROFILE_ID}.json`);
      const configPath = path.join(root, "claude_desktop_config.json");
      return {
        root,
        configPath,
        metaPath,
        profilePath,
        configSource: await readOptional(configPath),
        metaSource: await readOptional(metaPath),
        profileSource: await readOptional(profilePath),
      };
    }),
  );

  if (!context.globalState.get<boolean>(CLAUDE_MANAGED_STATE_KEY, false)) {
    const previous: ClaudePrevious = {
      code: captureClaudeCodePrevious(codeSource, codePath),
      normal: normalSources.map((item) => ({
        path: item.path,
        deploymentMode: captureDeploymentMode(item.source, item.path),
      })),
      thirdParty: thirdPartySources.map((item) => {
        const meta = parseJsonObject(item.metaSource, item.metaPath);
        const profile = parseJsonObject(item.profileSource, item.profilePath);
        if (meta.entries !== undefined && !Array.isArray(meta.entries)) {
          throw new Error(`Expected entries to be an array in ${item.metaPath}.`);
        }
        const entry = Array.isArray(meta.entries)
          ? meta.entries.find((candidate) => isJsonObject(candidate) && candidate.id === CLAUDE_DESKTOP_PROFILE_ID)
          : undefined;
        return {
          root: item.root,
          deploymentMode: captureDeploymentMode(item.configSource, item.configPath),
          entry: entry === undefined ? { exists: false } : { exists: true, value: entry },
          appliedId: storedValue(meta, "appliedId"),
          profile: item.profileSource ? { exists: true, value: profile } : { exists: false },
        };
      }),
    };
    await context.secrets.store(CLAUDE_PREVIOUS_SECRET_KEY, JSON.stringify(previous));
  }

  const changedFiles = [
    codePath,
    ...normalSources.map((item) => item.path),
    ...thirdPartySources.flatMap((item) => [item.configPath, item.profilePath, item.metaPath]),
  ];
  const backups = (
    await Promise.all(changedFiles.map((filePath) => backupExistingFile(filePath)))
  ).filter((value): value is string => Boolean(value));

  await writePrivateFile(codePath, applyClaudeCodeSettings(codeSource, codePath, apiKey, models, baseUrl));
  for (const item of normalSources) {
    await writePrivateFile(item.path, applyDeploymentMode(item.source, item.path));
  }
  for (const item of thirdPartySources) {
    await writePrivateFile(item.configPath, applyDeploymentMode(item.configSource, item.configPath));
    const existingProfile = parseJsonObject(item.profileSource, item.profilePath);
    await writePrivateFile(
      item.profilePath,
      JSON.stringify(buildClaudeDesktopProfile(existingProfile, apiKey, models, baseUrl), null, 2),
    );
    await writePrivateFile(item.metaPath, applyClaudeDesktopMeta(item.metaSource, item.metaPath));
  }
  await context.globalState.update(CLAUDE_MANAGED_STATE_KEY, true);
  return { changedFiles, backups };
}

export async function updateClaudeConfiguration(
  context: vscode.ExtensionContext,
  apiKey: string,
  models: readonly HackathonModel[],
  baseUrl: string,
): Promise<void> {
  if (!context.globalState.get<boolean>(CLAUDE_MANAGED_STATE_KEY, false)) return;
  await configureClaude(context, apiKey, models, baseUrl);
}

export async function removeClaudeConfiguration(context: vscode.ExtensionContext): Promise<string[]> {
  if (!context.globalState.get<boolean>(CLAUDE_MANAGED_STATE_KEY, false)) return [];
  const raw = await context.secrets.get(CLAUDE_PREVIOUS_SECRET_KEY);
  if (!raw) throw new Error("The Claude configuration restore record is missing.");
  const previous = JSON.parse(raw) as ClaudePrevious;
  const codePath = claudeCodeSettingsPath(os.homedir());
  const changedFiles = [
    codePath,
    ...previous.normal.map((item) => item.path),
    ...previous.thirdParty.flatMap((item) => [
      path.join(item.root, "claude_desktop_config.json"),
      path.join(item.root, "configLibrary", `${CLAUDE_DESKTOP_PROFILE_ID}.json`),
      path.join(item.root, "configLibrary", "_meta.json"),
    ]),
  ];
  const backups = (
    await Promise.all(changedFiles.map((filePath) => backupExistingFile(filePath)))
  ).filter((value): value is string => Boolean(value));

  const codeSource = await readOptional(codePath);
  await writePrivateFile(codePath, restoreClaudeCodeSettings(codeSource, codePath, previous.code));
  for (const item of previous.normal) {
    const source = await readOptional(item.path);
    await writePrivateFile(item.path, restoreDeploymentMode(source, item.path, item.deploymentMode));
  }
  for (const item of previous.thirdParty) {
    const configPath = path.join(item.root, "claude_desktop_config.json");
    const metaPath = path.join(item.root, "configLibrary", "_meta.json");
    const profilePath = path.join(item.root, "configLibrary", `${CLAUDE_DESKTOP_PROFILE_ID}.json`);
    const metaSource = await readOptional(metaPath);
    const configSource = await readOptional(configPath);
    await writePrivateFile(configPath, restoreDeploymentMode(configSource, configPath, item.deploymentMode));
    const meta = parseJsonObject(metaSource, metaPath);
    const entries = Array.isArray(meta.entries)
      ? meta.entries.filter((entry) => !isJsonObject(entry) || entry.id !== CLAUDE_DESKTOP_PROFILE_ID)
      : [];
    if (item.entry.exists) entries.push(item.entry.value);
    const restoredMeta = setJsoncValues(metaSource, [
      { path: ["entries"], value: entries },
      { path: ["appliedId"], value: item.appliedId.exists ? item.appliedId.value : undefined },
    ]);
    await writePrivateFile(metaPath, restoredMeta);
    if (item.profile.exists) {
      await writePrivateFile(profilePath, JSON.stringify(item.profile.value as JsonObject, null, 2));
    } else {
      await unlink(profilePath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
  await context.globalState.update(CLAUDE_MANAGED_STATE_KEY, false);
  await context.secrets.delete(CLAUDE_PREVIOUS_SECRET_KEY);
  return backups;
}

async function resolveDesktopRoots(
  platform: NodeJS.Platform,
  home: string,
): Promise<{ normal: string[]; thirdParty: string[] }> {
  const candidates = resolveClaudeDesktopCandidates(platform, home);
  const normal = await existingOrPrimary(candidates.normal);
  const thirdParty = await existingOrPrimary(candidates.thirdParty);
  if (platform === "win32" && candidates.packagesRoot && await isDirectory(candidates.packagesRoot)) {
    const packages = await readdir(candidates.packagesRoot, { withFileTypes: true });
    for (const entry of packages) {
      if (!entry.isDirectory() || !/^Claude_/i.test(entry.name)) continue;
      const roaming = path.join(candidates.packagesRoot, entry.name, "LocalCache", "Roaming");
      for (const name of ["Claude", "Claude Nest"]) {
        const candidate = path.join(roaming, name);
        if (await isDirectory(candidate) && !normal.includes(candidate)) normal.push(candidate);
      }
      for (const name of ["Claude-3p", "Claude Nest-3p"]) {
        const candidate = path.join(roaming, name);
        if (await isDirectory(candidate) && !thirdParty.includes(candidate)) thirdParty.push(candidate);
      }
    }
  }
  return { normal, thirdParty };
}

async function existingOrPrimary(candidates: string[]): Promise<string[]> {
  const existing: string[] = [];
  for (const candidate of candidates) if (await isDirectory(candidate)) existing.push(candidate);
  return existing.length ? existing : [candidates[0]!];
}

async function isDirectory(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
