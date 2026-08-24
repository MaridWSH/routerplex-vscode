import assert from "node:assert/strict";
import test from "node:test";

import { displayName, fallbackModels, fetchModels, restrictToRoster, type HackathonModel } from "./models.js";

const catalogModel = (id: string, extra: Partial<HackathonModel> = {}): HackathonModel => ({
  id,
  provider: "Vendor",
  mode: "chat",
  context: "1M",
  context_tokens: 1000000,
  input_per_1m: 1,
  output_per_1m: 2,
  vision: false,
  ...extra,
});

test("keeps only the models the team was granted", () => {
  const models = restrictToRoster(
    [catalogModel("mimo-v2.5"), catalogModel("claude-opus-5"), catalogModel("gpt-5.6-luna")],
    ["mimo-v2.5", "gpt-5.6-luna"],
  );
  assert.deepEqual(models.map((model) => model.id), ["mimo-v2.5", "gpt-5.6-luna"]);
});

test("still lists a granted model the catalog has never heard of", () => {
  const models = restrictToRoster([catalogModel("mimo-v2.5")], ["mimo-v2.5", "brand-new-model"]);
  const unknown = models.find((model) => model.id === "brand-new-model");
  assert.equal(unknown?.provider, "Hackathon");
  assert.equal(unknown?.context, "unknown");
});

test("the offline fallback covers the hackathon roster", () => {
  const models = fallbackModels(["mimo-v2.5-pro", "kimi-k2.7"]);
  assert.deepEqual(models.map((model) => model.id), ["mimo-v2.5-pro", "kimi-k2.7"]);
  assert.equal(models[0]?.provider, "Xiaomi");
});

test("fetches and restricts a catalog response", async () => {
  const stub = (async () =>
    new Response(JSON.stringify({ models: [catalogModel("mimo-v2.5"), catalogModel("claude-opus-5")] }), {
      status: 200,
    })) as unknown as typeof fetch;

  const models = await fetchModels("https://example.test/models", ["mimo-v2.5"], stub);
  assert.deepEqual(models.map((model) => model.id), ["mimo-v2.5"]);
});

test("labels models the way the picker shows them", () => {
  assert.equal(displayName("mimo-v2.5-pro"), "MIMO v2.5 Pro");
  assert.equal(displayName("kimi-k2.7"), "KIMI K2.7");
});
