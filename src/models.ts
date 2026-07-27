import { DEFAULT_CODEX_MODEL } from "./constants.js";

export interface RouterPlexModel {
  id: string;
  provider: string;
  mode: string;
  context: string;
  context_tokens: number | null;
  input_per_1m: number;
  output_per_1m: number;
  vision: boolean;
}

const RECOMMENDED_ORDER = [
  DEFAULT_CODEX_MODEL,
  "claude-sonnet-5",
  "gpt-5.6-terra",
  "gemini-3.5-flash",
  "deepseek-v4-pro",
  "kimi-k3",
  "gpt-5.6-luna",
];

const FALLBACK_MODELS: RouterPlexModel[] = [
  {
    id: "gpt-5.6-sol",
    provider: "OpenAI",
    mode: "chat",
    context: "258K",
    context_tokens: 258000,
    input_per_1m: 5,
    output_per_1m: 30,
    vision: true,
  },
  {
    id: "gpt-5.6-terra",
    provider: "OpenAI",
    mode: "chat",
    context: "258K",
    context_tokens: 258000,
    input_per_1m: 2.5,
    output_per_1m: 15,
    vision: true,
  },
  {
    id: "claude-sonnet-5",
    provider: "Anthropic",
    mode: "chat",
    context: "1M",
    context_tokens: 1000000,
    input_per_1m: 2,
    output_per_1m: 10,
    vision: true,
  },
  {
    id: "gemini-3.5-flash",
    provider: "Google",
    mode: "chat",
    context: "1M",
    context_tokens: 1000000,
    input_per_1m: 1.5,
    output_per_1m: 9,
    vision: false,
  },
];

export function isRouterPlexModel(value: unknown): value is RouterPlexModel {
  if (!value || typeof value !== "object") return false;
  const model = value as Partial<RouterPlexModel>;
  return (
    typeof model.id === "string" &&
    typeof model.provider === "string" &&
    typeof model.mode === "string" &&
    typeof model.context === "string" &&
    (typeof model.context_tokens === "number" || model.context_tokens === null) &&
    typeof model.input_per_1m === "number" &&
    typeof model.output_per_1m === "number" &&
    typeof model.vision === "boolean"
  );
}

export function sortChatModels(models: RouterPlexModel[]): RouterPlexModel[] {
  const ranks = new Map(RECOMMENDED_ORDER.map((id, index) => [id, index]));
  return models
    .filter((model) => model.mode === "chat")
    .sort((left, right) => {
      const leftRank = ranks.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = ranks.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) return leftRank - rightRank;
      const providerOrder = left.provider.localeCompare(right.provider);
      return providerOrder || left.id.localeCompare(right.id);
    });
}

export function fallbackModels(): RouterPlexModel[] {
  return sortChatModels([...FALLBACK_MODELS]);
}

export async function fetchModels(
  catalogUrl: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<RouterPlexModel[]> {
  const response = await fetchImplementation(catalogUrl, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new Error(`RouterPlex model catalog returned HTTP ${response.status}.`);
  }

  const body = (await response.json()) as { models?: unknown[] };
  const models = (body.models ?? []).filter(isRouterPlexModel);
  if (models.length === 0) {
    throw new Error("RouterPlex model catalog did not contain any usable models.");
  }
  return sortChatModels(models);
}

export function displayName(modelId: string): string {
  return modelId
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => {
      if (/^(gpt|glm|kimi|qwen|mimo)$/i.test(part)) return part.toUpperCase();
      return `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`;
    })
    .join(" ");
}

export function modelPriceDetail(model: RouterPlexModel): string {
  return `${model.provider} | ${model.context} | $${model.input_per_1m}/$${model.output_per_1m} per 1M`;
}
