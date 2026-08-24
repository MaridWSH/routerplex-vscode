import assert from "node:assert/strict";
import test from "node:test";

import {
  CLAUDE_DESKTOP_PROFILE_ID,
  anthropicBaseUrl,
  applyClaudeCodeSettings,
  applyClaudeDesktopMeta,
  buildClaudeDesktopProfile,
  captureClaudeCodePrevious,
  resolveClaudeDesktopCandidates,
  restoreClaudeCodeSettings,
} from "./claudeConfig.js";
import { parseJsonObject } from "./jsonConfig.js";
import { fallbackModels } from "./models.js";

const models = fallbackModels(["mimo-v2.5-pro", "mimo-v2.5", "qwen3.7-plus", "kimi-k2.7", "gpt-5.6-luna"]);

test("uses the Anthropic gateway origin while clients append v1/messages", () => {
  assert.equal(anthropicBaseUrl("https://hackathon.routerplex.com/v1/"), "https://hackathon.routerplex.com");
});

test("merges Claude Code environment settings and can restore them", () => {
  const source = '{"theme":"dark","env":{"KEEP":"yes","ANTHROPIC_MODEL":"old-model"}}\n';
  const previous = captureClaudeCodePrevious(source, "settings.json");
  const configured = applyClaudeCodeSettings(
    source,
    "settings.json",
    "sk-team",
    models,
    "https://hackathon.routerplex.com/v1",
  );
  const value = parseJsonObject(configured, "settings.json");
  const environment = value.env as Record<string, unknown>;

  assert.equal(value.theme, "dark");
  assert.equal(environment.KEEP, "yes");
  assert.equal(environment.ANTHROPIC_BASE_URL, "https://hackathon.routerplex.com");
  assert.equal(environment.ANTHROPIC_AUTH_TOKEN, "sk-team");
  assert.equal(environment.ANTHROPIC_MODEL, "mimo-v2.5-pro");
  assert.equal(environment.ANTHROPIC_SMALL_FAST_MODEL, "mimo-v2.5");
  assert.deepEqual(
    parseJsonObject(restoreClaudeCodeSettings(configured, "settings.json", previous), "settings.json"),
    parseJsonObject(source, "settings.json"),
  );
});

test("builds a Claude Desktop 3P profile with exact team model IDs", () => {
  const profile = buildClaudeDesktopProfile({}, "sk-team", models, "https://hackathon.routerplex.com/v1");
  const inferenceModels = profile.inferenceModels as Array<Record<string, unknown>>;

  assert.equal(profile.inferenceProvider, "gateway");
  assert.equal(profile.inferenceGatewayBaseUrl, "https://hackathon.routerplex.com");
  assert.equal(profile.inferenceGatewayAuthScheme, "bearer");
  assert.equal(profile.isClaudeCodeForDesktopEnabled, true);
  assert.deepEqual(inferenceModels.map((model) => model.name), models.map((model) => model.id));
  assert.equal(inferenceModels[0]?.anthropicFamilyTier, "sonnet");
  assert.equal(inferenceModels[0]?.supports1m, true);
});

test("adds the hackathon profile to Claude Desktop metadata", () => {
  const configured = applyClaudeDesktopMeta('{"entries":[{"id":"other","name":"Other"}]}\n', "_meta.json");
  const meta = parseJsonObject(configured, "_meta.json");
  assert.equal(meta.appliedId, CLAUDE_DESKTOP_PROFILE_ID);
  assert.deepEqual((meta.entries as Array<Record<string, unknown>>).map((entry) => entry.id), ["other", CLAUDE_DESKTOP_PROFILE_ID]);
});

test("resolves documented Claude Desktop roots on Windows and macOS", () => {
  const windows = resolveClaudeDesktopCandidates("win32", "C:\\Users\\Ada", {
    LOCALAPPDATA: "C:\\Users\\Ada\\AppData\\Local",
  });
  assert.equal(windows.normal[0], "C:\\Users\\Ada\\AppData\\Local\\Claude");
  assert.equal(windows.thirdParty[0], "C:\\Users\\Ada\\AppData\\Local\\Claude-3p");
  assert.equal(windows.packagesRoot, "C:\\Users\\Ada\\AppData\\Local\\Packages");

  const mac = resolveClaudeDesktopCandidates("darwin", "/Users/ada", {});
  assert.equal(mac.normal[0], "/Users/ada/Library/Application Support/Claude");
  assert.equal(mac.thirdParty[0], "/Users/ada/Library/Application Support/Claude-3p");
});
