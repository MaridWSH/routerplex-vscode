import { DEFAULT_CODEX_MODEL } from "./constants.js";

export interface HackathonModel {
  id: string;
  provider: string;
  mode: string;
  context: string;
  context_tokens: number | null;
  input_per_1m: number;
  output_per_1m: number;
  vision: boolean;
}

// Roster order for the panel: the coding default first, then by price.
const RECOMMENDED_ORDER = [DEFAULT_CODEX_MODEL, "mimo-v2.5", "qwen3.7-plus", "kimi-k2.7", "gpt-5.6-luna"];

// Used when the public catalog is unreachable on venue wifi. These are the
// models the hackathon gateway actually serves, so the panel still reads right.
const FALLBACK_MODELS: HackathonModel[] = [
  {
    id: "mimo-v2.5-pro",
    provider: "Xiaomi",
    mode: "chat",
    context: "1M",
    context_tokens: 1000000,
    input_per_1m: 0.44,
    output_per_1m: 0.87,
    vision: false,
  },
  {
    id: "mimo-v2.5",
    provider: "Xiaomi",
    mode: "chat",
    context: "1M",
    context_tokens: 1000000,
    input_per_1m: 0.11,
    output_per_1m: 0.28,
    vision: false,
  },
  {
    id: "qwen3.7-plus",
    provider: "Alibaba",
    mode: "chat",
    context: "1M",
    context_tokens: 1000000,
    input_per_1m: 0.32,
    output_per_1m: 1.28,
    vision: false,
  },
  {
    id: "kimi-k2.7",
    provider: "Moonshot",
    mode: "chat",
    context: "256K",
    context_tokens: 256000,
    input_per_1m: 0.95,
    output_per_1m: 4,
    vision: false,
  },
  {
    id: "gpt-5.6-luna",
    provider: "OpenAI",
    mode: "chat",
    context: "258K",
    context_tokens: 258000,
    input_per_1m: 1,
    output_per_1m: 6,
    vision: true,
  },
];

export function isHackathonModel(value: unknown): value is HackathonModel {
  if (!value || typeof value !== "object") return false;
  const model = value as Partial<HackathonModel>;
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

export function sortChatModels(models: HackathonModel[]): HackathonModel[] {
  const ranks = new Map(RECOMMENDED_ORDER.map((id, index) => [id, index]));
  return models
    .filter((model) => model.mode === "chat")
    .sort((left, right) => {
      const leftRank = ranks.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = ranks.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return left.id.localeCompare(right.id);
    });
}

/**
 * The gateway decides what a team may call; the catalog only decorates it.
 * Anything the console did not hand out is dropped, and anything the catalog
 * has never heard of still shows up so a new model is usable the day it lands.
 */
export function restrictToRoster(models: HackathonModel[], allowed: readonly string[]): HackathonModel[] {
  const roster = new Set(allowed);
  const described = new Map(models.map((model) => [model.id, model]));
  return sortChatModels(
    [...roster].map((id) => described.get(id) ?? unknownModel(id)),
  );
}

function unknownModel(id: string): HackathonModel {
  return {
    id,
    provider: "Hackathon",
    mode: "chat",
    context: "unknown",
    context_tokens: null,
    input_per_1m: 0,
    output_per_1m: 0,
    vision: false,
  };
}

export function fallbackModels(allowed: readonly string[]): HackathonModel[] {
  return restrictToRoster([...FALLBACK_MODELS], allowed);
}

export async function fetchModels(
  catalogUrl: string,
  allowed: readonly string[],
  fetchImplementation: typeof fetch = fetch,
): Promise<HackathonModel[]> {
  const response = await fetchImplementation(catalogUrl, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new Error(`The model catalog returned HTTP ${response.status}.`);
  }

  const body = (await response.json()) as { models?: unknown[] };
  const models = (body.models ?? []).filter(isHackathonModel);
  if (models.length === 0) {
    throw new Error("The model catalog did not contain any usable models.");
  }
  return restrictToRoster(models, allowed);
}

export function displayName(modelId: string): string {
  return modelId
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => {
      if (/^(gpt|glm|kimi|qwen|mimo)$/i.test(part)) return part.toUpperCase();
      if (/^v?\d/.test(part)) return part;
      return `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`;
    })
    .join(" ");
}

export function modelPriceDetail(model: HackathonModel): string {
  if (!model.input_per_1m && !model.output_per_1m) return `${model.provider} | ${model.context}`;
  return `${model.provider} | ${model.context} | $${model.input_per_1m}/$${model.output_per_1m} per 1M`;
}
