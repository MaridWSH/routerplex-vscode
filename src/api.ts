import type { RouterPlexModel } from "./models.js";

export class RouterPlexApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RouterPlexApiError";
  }
}

export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export async function validateApiKey(
  baseUrl: string,
  apiKey: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImplementation(`${normalizeBaseUrl(baseUrl)}/models`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new RouterPlexApiError(connectionErrorMessage(response.status), response.status);
  }
}

export function connectionErrorMessage(status: number): string {
  if (status === 401 || status === 403) return "The RouterPlex API key is invalid or has been revoked.";
  if (status === 402) return "The RouterPlex account needs available credit.";
  if (status === 429) return "RouterPlex rate-limited the connection test. Try again shortly.";
  return `RouterPlex returned HTTP ${status}.`;
}

export interface OpenAiToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAiMessage {
  role: "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenAiToolCall[];
}

export interface OpenAiChatRequest {
  model: string;
  messages: OpenAiMessage[];
  stream: true;
  tools?: Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: object;
    };
  }>;
  tool_choice?: "auto" | "required";
  reasoning_effort?: string;
}

export interface ProviderModel extends RouterPlexModel {
  maxOutputTokens: number;
}
