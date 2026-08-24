import path from "node:path";

import { DEFAULT_CODEX_MODEL } from "./constants.js";
import { isJsonObject, parseJsonObject, setJsoncValues, type JsonObject } from "./jsonConfig.js";
import { displayName, type HackathonModel } from "./models.js";
import { orderedModels } from "./opencodeConfig.js";

export const CLAUDE_DESKTOP_PROFILE_ID = "4656cc72-f2f7-4e80-bf75-ad168f917ea4";
export const CLAUDE_DESKTOP_PROFILE_NAME = "RouterPlex Hackathon";

export const CLAUDE_ENVIRONMENT_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY",
] as const;

type ClaudeEnvironmentKey = (typeof CLAUDE_ENVIRONMENT_KEYS)[number];

export interface StoredValue {
  exists: boolean;
  value?: unknown;
}

export interface ClaudeDesktopCandidates {
  normal: string[];
  thirdParty: string[];
  packagesRoot?: string;
}

export function resolveClaudeDesktopCandidates(
  platform: NodeJS.Platform,
  home: string,
  environment: NodeJS.ProcessEnv = process.env,
): ClaudeDesktopCandidates {
  const paths = platform === "win32" ? path.win32 : path.posix;
  if (platform === "win32") {
    const localAppData = environment.LOCALAPPDATA || paths.join(home, "AppData", "Local");
    return {
      normal: [paths.join(localAppData, "Claude"), paths.join(localAppData, "Claude Nest")],
      thirdParty: [paths.join(localAppData, "Claude-3p"), paths.join(localAppData, "Claude Nest-3p")],
      packagesRoot: paths.join(localAppData, "Packages"),
    };
  }
  if (platform === "darwin") {
    const applicationSupport = paths.join(home, "Library", "Application Support");
    return {
      normal: [paths.join(applicationSupport, "Claude"), paths.join(applicationSupport, "Claude Nest")],
      thirdParty: [paths.join(applicationSupport, "Claude-3p"), paths.join(applicationSupport, "Claude Nest-3p")],
    };
  }
  throw new Error("Claude Desktop setup is supported on Windows and macOS.");
}

export function claudeCodeSettingsPath(home: string): string {
  return path.join(home, ".claude", "settings.json");
}

export function anthropicBaseUrl(openAiBaseUrl: string): string {
  const normalized = openAiBaseUrl.replace(/\/+$/, "");
  return normalized.replace(/\/v1$/i, "");
}

export function claudeEnvironment(
  apiKey: string,
  models: readonly HackathonModel[],
  baseUrl: string,
): Record<ClaudeEnvironmentKey, string> {
  const ordered = orderedModels(models);
  if (!ordered.length) throw new Error("No hackathon models are available for Claude.");
  const primary = ordered[0]!.id;
  const small = [...ordered]
    .filter((model) => model.id !== primary)
    .sort((left, right) => (left.input_per_1m + left.output_per_1m) - (right.input_per_1m + right.output_per_1m))[0]?.id
    ?? primary;
  return {
    ANTHROPIC_BASE_URL: anthropicBaseUrl(baseUrl),
    ANTHROPIC_AUTH_TOKEN: apiKey,
    ANTHROPIC_MODEL: primary,
    ANTHROPIC_SMALL_FAST_MODEL: small,
    ANTHROPIC_DEFAULT_SONNET_MODEL: primary,
    ANTHROPIC_DEFAULT_OPUS_MODEL: ordered[1]?.id ?? primary,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: small,
    CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "1",
  };
}

export function captureClaudeCodePrevious(source: string, filePath: string): Record<ClaudeEnvironmentKey, StoredValue> {
  const settings = parseJsonObject(source, filePath);
  const environment = isJsonObject(settings.env) ? settings.env : {};
  return Object.fromEntries(
    CLAUDE_ENVIRONMENT_KEYS.map((key) => [key, storedValue(environment, key)]),
  ) as Record<ClaudeEnvironmentKey, StoredValue>;
}

export function applyClaudeCodeSettings(
  source: string,
  filePath: string,
  apiKey: string,
  models: readonly HackathonModel[],
  baseUrl: string,
): string {
  const settings = parseJsonObject(source, filePath);
  if (settings.env !== undefined && !isJsonObject(settings.env)) {
    throw new Error(`Expected env to be a JSON object in ${filePath}.`);
  }
  return setJsoncValues(source, [
    { path: ["env"], value: { ...(settings.env as JsonObject | undefined), ...claudeEnvironment(apiKey, models, baseUrl) } },
  ]);
}

export function restoreClaudeCodeSettings(
  source: string,
  filePath: string,
  previous: Record<ClaudeEnvironmentKey, StoredValue>,
): string {
  parseJsonObject(source, filePath);
  return setJsoncValues(
    source,
    CLAUDE_ENVIRONMENT_KEYS.map((key) => ({
      path: ["env", key],
      value: previous[key].exists ? previous[key].value : undefined,
    })),
  );
}

export function captureDeploymentMode(source: string, filePath: string): StoredValue {
  return storedValue(parseJsonObject(source, filePath), "deploymentMode");
}

export function applyDeploymentMode(source: string, filePath: string): string {
  parseJsonObject(source, filePath);
  return setJsoncValues(source, [{ path: ["deploymentMode"], value: "3p" }]);
}

export function restoreDeploymentMode(source: string, filePath: string, previous: StoredValue): string {
  parseJsonObject(source, filePath);
  return setJsoncValues(source, [
    { path: ["deploymentMode"], value: previous.exists ? previous.value : undefined },
  ]);
}

export function desktopInferenceModels(models: readonly HackathonModel[]): JsonObject[] {
  const tiers = ["sonnet", "opus", "haiku", "fable", "mythos"] as const;
  return orderedModels(models).map((model, index) => ({
    name: model.id,
    labelOverride: displayName(model.id),
    ...(model.context_tokens && model.context_tokens >= 1_000_000 ? { supports1m: true } : {}),
    ...(tiers[index] ? { anthropicFamilyTier: tiers[index], isFamilyDefault: true } : {}),
  }));
}

export function buildClaudeDesktopProfile(
  existing: JsonObject,
  apiKey: string,
  models: readonly HackathonModel[],
  baseUrl: string,
): JsonObject {
  if (!models.length) throw new Error("No hackathon models are available for Claude Desktop.");
  return {
    ...existing,
    inferenceProvider: "gateway",
    inferenceGatewayBaseUrl: anthropicBaseUrl(baseUrl),
    inferenceGatewayApiKey: apiKey,
    inferenceGatewayAuthScheme: "bearer",
    disableDeploymentModeChooser: true,
    modelDiscoveryEnabled: false,
    chatTabEnabled: true,
    coworkTabEnabled: true,
    isClaudeCodeForDesktopEnabled: true,
    coworkEgressAllowedHosts: ["*"],
    inferenceModels: desktopInferenceModels(models),
  };
}

export function applyClaudeDesktopMeta(source: string, filePath: string): string {
  const meta = parseJsonObject(source, filePath);
  if (meta.entries !== undefined && !Array.isArray(meta.entries)) {
    throw new Error(`Expected entries to be an array in ${filePath}.`);
  }
  const entries = (meta.entries ?? []).filter(
    (entry) => !isJsonObject(entry) || entry.id !== CLAUDE_DESKTOP_PROFILE_ID,
  );
  entries.push({ id: CLAUDE_DESKTOP_PROFILE_ID, name: CLAUDE_DESKTOP_PROFILE_NAME });
  return setJsoncValues(source, [
    { path: ["entries"], value: entries },
    { path: ["appliedId"], value: CLAUDE_DESKTOP_PROFILE_ID },
  ]);
}

export function storedValue(object: JsonObject, key: string): StoredValue {
  return Object.prototype.hasOwnProperty.call(object, key)
    ? { exists: true, value: object[key] }
    : { exists: false };
}

export function preferredClaudeModel(models: readonly HackathonModel[]): string {
  return models.find((model) => model.id === DEFAULT_CODEX_MODEL)?.id ?? models[0]?.id ?? "";
}
