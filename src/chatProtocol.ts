import type { OpenAiContentPart, OpenAiMessage } from "./api.js";

export type InternalChatPart =
  | { kind: "text"; value: string }
  | { kind: "image"; mimeType: string; base64: string }
  | { kind: "tool-call"; callId: string; name: string; input: object }
  | { kind: "tool-result"; callId: string; value: string };

export interface InternalChatMessage {
  role: "user" | "assistant";
  name?: string;
  content: InternalChatPart[];
}

function joinText(parts: InternalChatPart[]): string {
  return parts
    .filter((part): part is Extract<InternalChatPart, { kind: "text" }> => part.kind === "text")
    .map((part) => part.value)
    .join("");
}

export function toOpenAiMessages(messages: InternalChatMessage[]): OpenAiMessage[] {
  const result: OpenAiMessage[] = [];

  for (const message of messages) {
    if (message.role === "assistant") {
      const toolCalls = message.content
        .filter((part): part is Extract<InternalChatPart, { kind: "tool-call" }> => part.kind === "tool-call")
        .map((part) => ({
          id: part.callId,
          type: "function" as const,
          function: { name: part.name, arguments: JSON.stringify(part.input) },
        }));
      result.push({
        role: "assistant",
        content: joinText(message.content) || null,
        ...(message.name ? { name: message.name } : {}),
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }

    const text = joinText(message.content);
    const images = message.content.filter(
      (part): part is Extract<InternalChatPart, { kind: "image" }> => part.kind === "image",
    );
    if (images.length) {
      // Chat Completions only accepts images through the array content form, so
      // any text on the same turn has to travel as a part alongside them.
      const parts: OpenAiContentPart[] = [];
      if (text) parts.push({ type: "text", text });
      for (const image of images) {
        parts.push({ type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.base64}` } });
      }
      result.push({ role: "user", content: parts, ...(message.name ? { name: message.name } : {}) });
    } else if (text) {
      result.push({ role: "user", content: text, ...(message.name ? { name: message.name } : {}) });
    }
    for (const part of message.content) {
      if (part.kind === "tool-result") {
        result.push({ role: "tool", content: part.value, tool_call_id: part.callId });
      }
    }
    if (!text && !images.length && !message.content.some((part) => part.kind === "tool-result")) {
      result.push({ role: "user", content: "", ...(message.name ? { name: message.name } : {}) });
    }
  }

  return result;
}

export async function* parseSseData(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const match = buffer.match(/\r?\n\r?\n/);
        if (!match || match.index === undefined) break;
        const event = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const data = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data) yield data;
      }
    }

    buffer += decoder.decode();
    const data = buffer
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data) yield data;
  } finally {
    reader.releaseLock();
  }
}

interface ToolCallDelta {
  index?: number;
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface CompletedToolCall {
  callId: string;
  name: string;
  input: object;
}

export class ToolCallAccumulator {
  private readonly pending = new Map<number, PendingToolCall>();

  append(deltas: ToolCallDelta[] | undefined): void {
    for (const delta of deltas ?? []) {
      const index = delta.index ?? 0;
      const current = this.pending.get(index) ?? { id: "", name: "", arguments: "" };
      current.id += delta.id ?? "";
      current.name += delta.function?.name ?? "";
      current.arguments += delta.function?.arguments ?? "";
      this.pending.set(index, current);
    }
  }

  finish(): CompletedToolCall[] {
    return [...this.pending.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, call]) => {
        let input: unknown = {};
        if (call.arguments.trim()) input = JSON.parse(call.arguments);
        if (!input || typeof input !== "object" || Array.isArray(input)) input = { value: input };
        return { callId: call.id, name: call.name, input: input as object };
      });
  }

  get size(): number {
    return this.pending.size;
  }
}
