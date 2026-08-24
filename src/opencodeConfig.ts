import path from "node:path";

import { DEFAULT_CODEX_MODEL, MAX_OUTPUT_TOKENS } from "./constants.js";
import { displayName, type HackathonModel } from "./models.js";
import { isJsonObject, parseJsonObject, setJsoncValues, type JsonObject } from "./jsonConfig.js";

export const OPENCODE_PROVIDER_ID = "routerplex-hackathon";

export interface OpenCodePaths {
  configPath: string;
  authPath: string;
}

export interface OpenCodePrevious {
  provider: PreviousValue;
  model: PreviousValue;
  auth: PreviousValue;
}

export interface PreviousValue {
  exists: boolean;
  value?: unknown;
}

export function resolveOpenCodePaths(
  home: string,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): OpenCodePaths {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const configRoot = environment.OPENCODE_CONFIG_DIR || environment.XDG_CONFIG_HOME || paths.join(home, ".config");
  const dataRoot = environment.XDG_DATA_HOME || paths.join(home, ".local", "share");
  return {
    configPath: paths.join(configRoot, "opencode", "opencode.json"),
    authPath: paths.join(dataRoot, "opencode", "auth.json"),
  };
}

export function orderedModels(models: readonly HackathonModel[]): HackathonModel[] {
  const copy = [...models];
  copy.sort((left, right) => Number(right.id === DEFAULT_CODEX_MODEL) - Number(left.id === DEFAULT_CODEX_MODEL));
  return copy;
}

export function captureOpenCodePrevious(config: JsonObject, auth: JsonObject): OpenCodePrevious {
  const providers = isJsonObject(config.provider) ? config.provider : {};
  return {
    provider: previousValue(providers, OPENCODE_PROVIDER_ID),
    model: previousValue(config, "model"),
    auth: previousValue(auth, OPENCODE_PROVIDER_ID),
  };
}

export function applyOpenCodeConfig(
  source: string,
  filePath: string,
  models: readonly HackathonModel[],
  baseUrl: string,
): string {
  parseJsonObject(source, filePath);
  const ordered = orderedModels(models);
  if (!ordered.length) throw new Error("No hackathon models are available for OpenCode.");

  const configuredModels = Object.fromEntries(
    ordered.map((model) => [
      model.id,
      {
        name: displayName(model.id),
        // OpenCode's schema requires context and output together. Emitting one
        // half invalidates the entire configuration file, not just this model.
        ...(model.context_tokens
          ? { limit: { context: model.context_tokens, output: MAX_OUTPUT_TOKENS } }
          : {}),
      },
    ]),
  );
  return setJsoncValues(source, [
    {
      path: ["provider", OPENCODE_PROVIDER_ID],
      value: {
        npm: "@ai-sdk/openai-compatible",
        name: "RouterPlex Hackathon",
        options: { baseURL: baseUrl.replace(/\/+$/, "") },
        models: configuredModels,
      },
    },
    { path: ["model"], value: `${OPENCODE_PROVIDER_ID}/${ordered[0]!.id}` },
  ]);
}

export function applyOpenCodeAuth(source: string, filePath: string, apiKey: string): string {
  parseJsonObject(source, filePath);
  return setJsoncValues(source, [
    { path: [OPENCODE_PROVIDER_ID], value: { type: "api", key: apiKey } },
  ]);
}

export function restoreOpenCodeConfig(source: string, filePath: string, previous?: OpenCodePrevious): string {
  parseJsonObject(source, filePath);
  const provider = previous?.provider ?? { exists: false };
  const model = previous?.model ?? { exists: false };
  return setJsoncValues(source, [
    { path: ["provider", OPENCODE_PROVIDER_ID], value: provider.exists ? provider.value : undefined },
    { path: ["model"], value: model.exists ? model.value : undefined },
  ]);
}

export function restoreOpenCodeAuth(source: string, filePath: string, previous?: OpenCodePrevious): string {
  parseJsonObject(source, filePath);
  const auth = previous?.auth ?? { exists: false };
  return setJsoncValues(source, [
    { path: [OPENCODE_PROVIDER_ID], value: auth.exists ? auth.value : undefined },
  ]);
}

function previousValue(object: JsonObject, key: string): PreviousValue {
  return Object.prototype.hasOwnProperty.call(object, key)
    ? { exists: true, value: object[key] }
    : { exists: false };
}
