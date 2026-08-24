import type { HackathonModel } from "./models.js";

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GatewayError";
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
    throw new GatewayError(connectionErrorMessage(response.status), response.status);
  }
}

export function connectionErrorMessage(status: number): string {
  if (status === 401 || status === 403) {
    return "This key is no longer valid. Your seat may have moved to another team - ask an organiser.";
  }
  if (status === 402) return "The team budget is spent. Ask an organiser for a top up.";
  if (status === 429) return "The gateway is rate limiting. Try again in a moment.";
  return `The hackathon gateway returned HTTP ${status}.`;
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
}

export interface ProviderModel extends HackathonModel {
  maxOutputTokens: number;
}
