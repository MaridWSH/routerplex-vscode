import os from "node:os";
import * as vscode from "vscode";

import {
  OPENCODE_MANAGED_STATE_KEY,
  OPENCODE_PREVIOUS_SECRET_KEY,
} from "./constants.js";
import {
  backupExistingFile,
  parseJsonObject,
  readOptional,
  writePrivateFile,
} from "./jsonConfig.js";
import type { HackathonModel } from "./models.js";
import {
  applyOpenCodeAuth,
  applyOpenCodeConfig,
  captureOpenCodePrevious,
  resolveOpenCodePaths,
  restoreOpenCodeAuth,
  restoreOpenCodeConfig,
  type OpenCodePrevious,
} from "./opencodeConfig.js";

export interface OpenCodeConfigurationResult {
  configPath: string;
  authPath: string;
  backups: string[];
}

export async function configureOpenCode(
  context: vscode.ExtensionContext,
  apiKey: string,
  models: readonly HackathonModel[],
  baseUrl: string,
): Promise<OpenCodeConfigurationResult> {
  const paths = resolveOpenCodePaths(os.homedir());
  const [configSource, authSource] = await Promise.all([
    readOptional(paths.configPath),
    readOptional(paths.authPath),
  ]);
  const config = parseJsonObject(configSource, paths.configPath);
  const auth = parseJsonObject(authSource, paths.authPath);

  if (!context.globalState.get<boolean>(OPENCODE_MANAGED_STATE_KEY, false)) {
    const previous = captureOpenCodePrevious(config, auth);
    await context.secrets.store(OPENCODE_PREVIOUS_SECRET_KEY, JSON.stringify(previous));
  }

  const backups = (
    await Promise.all([backupExistingFile(paths.configPath), backupExistingFile(paths.authPath)])
  ).filter((value): value is string => Boolean(value));
  const nextConfig = applyOpenCodeConfig(configSource, paths.configPath, models, baseUrl);
  const nextAuth = applyOpenCodeAuth(authSource, paths.authPath, apiKey);
  await writePrivateFile(paths.authPath, nextAuth);
  await writePrivateFile(paths.configPath, nextConfig);
  await context.globalState.update(OPENCODE_MANAGED_STATE_KEY, true);
  return { ...paths, backups };
}

export async function updateOpenCodeConfiguration(
  context: vscode.ExtensionContext,
  apiKey: string,
  models: readonly HackathonModel[],
  baseUrl: string,
): Promise<void> {
  if (!context.globalState.get<boolean>(OPENCODE_MANAGED_STATE_KEY, false)) return;
  await configureOpenCode(context, apiKey, models, baseUrl);
}

export async function removeOpenCodeConfiguration(context: vscode.ExtensionContext): Promise<string[]> {
  if (!context.globalState.get<boolean>(OPENCODE_MANAGED_STATE_KEY, false)) return [];
  const paths = resolveOpenCodePaths(os.homedir());
  const [configSource, authSource, previousRaw] = await Promise.all([
    readOptional(paths.configPath),
    readOptional(paths.authPath),
    context.secrets.get(OPENCODE_PREVIOUS_SECRET_KEY),
  ]);
  const previous = previousRaw ? (JSON.parse(previousRaw) as OpenCodePrevious) : undefined;
  const backups = (
    await Promise.all([backupExistingFile(paths.configPath), backupExistingFile(paths.authPath)])
  ).filter((value): value is string => Boolean(value));
  await writePrivateFile(paths.configPath, restoreOpenCodeConfig(configSource, paths.configPath, previous));
  await writePrivateFile(paths.authPath, restoreOpenCodeAuth(authSource, paths.authPath, previous));
  await context.globalState.update(OPENCODE_MANAGED_STATE_KEY, false);
  await context.secrets.delete(OPENCODE_PREVIOUS_SECRET_KEY);
  return backups;
}
