import assert from "node:assert/strict";
import test from "node:test";

import { parseJsonObject } from "./jsonConfig.js";
import { fallbackModels } from "./models.js";
import {
  OPENCODE_PROVIDER_ID,
  applyOpenCodeAuth,
  applyOpenCodeConfig,
  captureOpenCodePrevious,
  restoreOpenCodeAuth,
  restoreOpenCodeConfig,
  resolveOpenCodePaths,
} from "./opencodeConfig.js";

const models = fallbackModels(["mimo-v2.5-pro", "mimo-v2.5", "gpt-5.6-luna"]);

test("adds a global OpenCode provider without replacing other JSONC settings", () => {
  const source = `{
  // keep this provider
  "provider": { "local": { "name": "Local" } },
  "theme": "system"
}\n`;
  const configured = applyOpenCodeConfig(source, "opencode.json", models, "https://hackathon.routerplex.com/v1/");
  const value = parseJsonObject(configured, "opencode.json");
  const providers = value.provider as Record<string, Record<string, unknown>>;
  const hackathon = providers[OPENCODE_PROVIDER_ID]!;

  assert.equal(value.theme, "system");
  assert.equal(providers.local?.name, "Local");
  assert.equal(hackathon.npm, "@ai-sdk/openai-compatible");
  assert.equal((hackathon.options as Record<string, unknown>).baseURL, "https://hackathon.routerplex.com/v1");
  assert.deepEqual(Object.keys(hackathon.models as object), ["mimo-v2.5-pro", "mimo-v2.5", "gpt-5.6-luna"]);
  assert.equal(value.model, "routerplex-hackathon/mimo-v2.5-pro");
  assert.match(configured, /keep this provider/);
});

test("stores OpenCode auth in the official provider credential shape", () => {
  const source = '{"other":{"type":"api","key":"leave-me"}}\n';
  const configured = applyOpenCodeAuth(source, "auth.json", "sk-hackathon");
  const value = parseJsonObject(configured, "auth.json");
  assert.deepEqual(value.other, { type: "api", key: "leave-me" });
  assert.deepEqual(value[OPENCODE_PROVIDER_ID], { type: "api", key: "sk-hackathon" });
});

test("restores the OpenCode values that setup replaced", () => {
  const configSource = '{"provider":{"routerplex-hackathon":{"name":"old"}},"model":"other/model"}\n';
  const authSource = '{"routerplex-hackathon":{"type":"api","key":"old-key"}}\n';
  const previous = captureOpenCodePrevious(
    parseJsonObject(configSource, "opencode.json"),
    parseJsonObject(authSource, "auth.json"),
  );
  const configured = applyOpenCodeConfig(configSource, "opencode.json", models, "https://example.test/v1");
  const configuredAuth = applyOpenCodeAuth(authSource, "auth.json", "new-key");

  assert.deepEqual(
    parseJsonObject(restoreOpenCodeConfig(configured, "opencode.json", previous), "opencode.json"),
    parseJsonObject(configSource, "opencode.json"),
  );
  assert.deepEqual(
    parseJsonObject(restoreOpenCodeAuth(configuredAuth, "auth.json", previous), "auth.json"),
    parseJsonObject(authSource, "auth.json"),
  );
});

test("resolves OpenCode's XDG paths on Windows and macOS", () => {
  assert.deepEqual(resolveOpenCodePaths("C:\\Users\\Ada", {}, "win32"), {
    configPath: "C:\\Users\\Ada\\.config\\opencode\\opencode.json",
    authPath: "C:\\Users\\Ada\\.local\\share\\opencode\\auth.json",
  });
  assert.deepEqual(resolveOpenCodePaths("/Users/ada", {}, "darwin"), {
    configPath: "/Users/ada/.config/opencode/opencode.json",
    authPath: "/Users/ada/.local/share/opencode/auth.json",
  });
});
