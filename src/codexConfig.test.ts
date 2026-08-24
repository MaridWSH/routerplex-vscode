import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "smol-toml";

import { applyHackathonConfig, removeHackathonConfig } from "./codexConfig.js";

const options = { model: "mimo-v2.5-pro", baseUrl: "https://hackathon.routerplex.com/v1" };

test("writes a valid provider table and root selection", () => {
  const result = applyHackathonConfig("", options);
  const parsed = parse(result.content) as Record<string, any>;

  assert.equal(parsed.model_provider, "routerplex-hackathon");
  assert.equal(parsed.model, "mimo-v2.5-pro");
  assert.equal(parsed.model_providers["routerplex-hackathon"].base_url, options.baseUrl);
  assert.equal(parsed.model_providers["routerplex-hackathon"].wire_api, "chat");
  assert.equal(parsed.model_providers["routerplex-hackathon"].env_key, "ROUTERPLEX_HACKATHON_API_KEY");
});

test("is idempotent and remembers the previous root selection once", () => {
  const first = applyHackathonConfig('model = "o3"\nmodel_provider = "openai"\n', options);
  assert.deepEqual(first.previousRootAssignments, ['model = "o3"', 'model_provider = "openai"']);

  const second = applyHackathonConfig(first.content, options);
  assert.equal((second.content.match(/RouterPlex Hackathon managed settings/g) ?? []).length, 2);
  assert.equal((second.content.match(/\[model_providers\.routerplex-hackathon]/g) ?? []).length, 1);
});

test("leaves the public RouterPlex provider table alone", () => {
  const source = [
    "[model_providers.routerplex]",
    'name = "RouterPlex"',
    'base_url = "https://api.routerplex.com/v1"',
    "",
  ].join("\n");
  const applied = applyHackathonConfig(source, options);
  assert.match(applied.content, /\[model_providers\.routerplex]/);

  const removed = removeHackathonConfig(applied.content, applied.previousRootAssignments);
  assert.match(removed, /\[model_providers\.routerplex]/);
  assert.doesNotMatch(removed, /routerplex-hackathon/);
});

test("restores what it replaced when removed", () => {
  const applied = applyHackathonConfig('model = "o3"\n[other]\nkey = 1\n', options);
  const removed = removeHackathonConfig(applied.content, applied.previousRootAssignments);
  const parsed = parse(removed) as Record<string, any>;

  assert.equal(parsed.model, "o3");
  assert.equal(parsed.other.key, 1);
  assert.equal(parsed.model_providers, undefined);
});
