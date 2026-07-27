import assert from "node:assert/strict";
import test from "node:test";

import { fetchModels, sortChatModels, type RouterPlexModel } from "./models.js";

function model(id: string, provider: string, mode = "chat"): RouterPlexModel {
  return {
    id,
    provider,
    mode,
    context: "128K",
    context_tokens: 128000,
    input_per_1m: 1,
    output_per_1m: 2,
    vision: false,
  };
}

test("sorts recommended coding models first and removes non-chat models", () => {
  const sorted = sortChatModels([
    model("zeta", "Zeta"),
    model("gpt-image-2", "OpenAI", "image_generation"),
    model("claude-sonnet-5", "Anthropic"),
    model("gpt-5.6-sol", "OpenAI"),
  ]);

  assert.deepEqual(
    sorted.map((item) => item.id),
    ["gpt-5.6-sol", "claude-sonnet-5", "zeta"],
  );
});

test("fetchModels validates and sorts the public catalog", async () => {
  const response = new Response(
    JSON.stringify({ models: [model("other", "Other"), model("gpt-5.6-sol", "OpenAI")] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
  const models = await fetchModels("https://example.test/models", async () => response);
  assert.deepEqual(
    models.map((item) => item.id),
    ["gpt-5.6-sol", "other"],
  );
});

test("fetchModels rejects unusable catalog responses", async () => {
  const response = new Response(JSON.stringify({ models: [{ id: "incomplete" }] }), { status: 200 });
  await assert.rejects(() => fetchModels("https://example.test/models", async () => response), /usable models/);
});
