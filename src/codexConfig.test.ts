import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "smol-toml";

import { applyRouterPlexConfig, removeRouterPlexConfig } from "./codexConfig.js";

const OPTIONS = {
  model: "gpt-5.6-sol",
  baseUrl: "https://api.routerplex.com/v1",
  authCommand: "/home/test user/routerplex-auth.sh",
  authArgs: [],
};

test("adds RouterPlex to an empty Codex configuration", () => {
  const result = applyRouterPlexConfig("", OPTIONS);
  const parsed = parse(result.content) as Record<string, unknown>;

  assert.equal(parsed.model_provider, "routerplex");
  assert.equal(parsed.model, "gpt-5.6-sol");
  assert.deepEqual(result.previousRootAssignments, []);
  assert.match(result.content, /wire_api = "responses"/);
  assert.match(result.content, /command = "\/home\/test user\/routerplex-auth\.sh"/);
});

test("preserves unrelated config and captures displaced root model settings", () => {
  const source = [
    '# existing comment',
    'model = "gpt-5.5"',
    'model_provider = "openai"',
    'approval_policy = "on-request"',
    '',
    '[desktop]',
    'followUpQueueMode = "queue"',
    '',
  ].join("\n");

  const result = applyRouterPlexConfig(source, OPTIONS);
  assert.deepEqual(result.previousRootAssignments, ['model = "gpt-5.5"', 'model_provider = "openai"']);
  assert.match(result.content, /approval_policy = "on-request"/);
  assert.match(result.content, /\[desktop]/);
  assert.equal((result.content.match(/^model_provider\s*=/gm) ?? []).length, 1);
  assert.equal((result.content.match(/^model\s*=/gm) ?? []).length, 1);
  parse(result.content);
});

test("reconfiguring replaces the managed provider without duplicates", () => {
  const first = applyRouterPlexConfig("", OPTIONS).content;
  const second = applyRouterPlexConfig(first, { ...OPTIONS, model: "claude-sonnet-5" }).content;

  assert.equal((second.match(/\[model_providers\.routerplex]/g) ?? []).length, 1);
  assert.equal((second.match(/\[model_providers\.routerplex\.auth]/g) ?? []).length, 1);
  assert.match(second, /model = "claude-sonnet-5"/);
  parse(second);
});

test("removal restores the previous model selection and leaves other tables", () => {
  const original = ['model = "gpt-5.5"', 'model_provider = "openai"', '', '[desktop]', 'enabled = true', ''].join(
    "\n",
  );
  const applied = applyRouterPlexConfig(original, OPTIONS);
  const removed = removeRouterPlexConfig(applied.content, applied.previousRootAssignments);

  assert.equal(removed, original);
  assert.doesNotMatch(removed, /RouterPlex managed/);
  assert.doesNotMatch(removed, /model_providers\.routerplex/);
  parse(removed);
});

test("escapes Windows command paths as valid TOML strings", () => {
  const result = applyRouterPlexConfig("", {
    ...OPTIONS,
    authCommand: "powershell.exe",
    authArgs: ["-File", "C:\\Users\\Ada Lovelace\\routerplex-auth.ps1"],
  });
  const parsed = parse(result.content) as {
    model_providers: { routerplex: { auth: { args: string[] } } };
  };

  assert.equal(parsed.model_providers.routerplex.auth.args[1], "C:\\Users\\Ada Lovelace\\routerplex-auth.ps1");
});
