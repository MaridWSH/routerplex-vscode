import assert from "node:assert/strict";
import test from "node:test";

import { parseSseData, ToolCallAccumulator, toOpenAiMessages } from "./chatProtocol.js";

test("translates text and tool messages to Chat Completions format", () => {
  const messages = toOpenAiMessages([
    { role: "user", content: [{ kind: "text", value: "Inspect the repository" }] },
    {
      role: "assistant",
      content: [
        { kind: "text", value: "I will inspect it." },
        { kind: "tool-call", callId: "call-1", name: "read_file", input: { path: "README.md" } },
      ],
    },
    {
      role: "user",
      content: [{ kind: "tool-result", callId: "call-1", value: "# RouterPlex" }],
    },
  ]);

  assert.deepEqual(messages, [
    { role: "user", content: "Inspect the repository" },
    {
      role: "assistant",
      content: "I will inspect it.",
      tool_calls: [
        {
          id: "call-1",
          type: "function",
          function: { name: "read_file", arguments: '{"path":"README.md"}' },
        },
      ],
    },
    { role: "tool", content: "# RouterPlex", tool_call_id: "call-1" },
  ]);
});

test("parses SSE events split across byte chunks", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hel'));
      controller.enqueue(encoder.encode('lo"}}]}\n\ndata: [DONE]\n\n'));
      controller.close();
    },
  });

  const events: string[] = [];
  for await (const event of parseSseData(stream)) events.push(event);
  assert.deepEqual(events, ['{"choices":[{"delta":{"content":"Hello"}}]}', "[DONE]"]);
});

test("accumulates streamed tool call arguments", () => {
  const accumulator = new ToolCallAccumulator();
  accumulator.append([{ index: 0, id: "call-", function: { name: "read_", arguments: '{"path":' } }]);
  accumulator.append([{ index: 0, id: "1", function: { name: "file", arguments: '"README.md"}' } }]);

  assert.deepEqual(accumulator.finish(), [
    { callId: "call-1", name: "read_file", input: { path: "README.md" } },
  ]);
});

test("sends an image attachment as an image_url content part", () => {
  const messages = toOpenAiMessages([
    {
      role: "user",
      content: [
        { kind: "text", value: "What is in this screenshot?" },
        { kind: "image", mimeType: "image/png", base64: "aGVsbG8=" },
      ],
    },
  ]);

  assert.deepEqual(messages, [
    {
      role: "user",
      content: [
        { type: "text", text: "What is in this screenshot?" },
        { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
      ],
    },
  ]);
});

test("sends an image with no accompanying text", () => {
  const messages = toOpenAiMessages([
    { role: "user", content: [{ kind: "image", mimeType: "image/jpeg", base64: "Zm9v" }] },
  ]);

  assert.deepEqual(messages, [
    {
      role: "user",
      content: [{ type: "image_url", image_url: { url: "data:image/jpeg;base64,Zm9v" } }],
    },
  ]);
});

test("keeps plain text messages on the string content form", () => {
  const messages = toOpenAiMessages([{ role: "user", content: [{ kind: "text", value: "no images here" }] }]);
  assert.deepEqual(messages, [{ role: "user", content: "no images here" }]);
});
