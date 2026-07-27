import * as vscode from "vscode";

import { normalizeBaseUrl, type OpenAiChatRequest } from "./api.js";
import {
  parseSseData,
  ToolCallAccumulator,
  toOpenAiMessages,
  type InternalChatMessage,
  type InternalChatPart,
} from "./chatProtocol.js";
import { DEFAULT_API_BASE_URL, DEFAULT_CATALOG_URL } from "./constants.js";
import { displayName, fallbackModels, fetchModels, modelPriceDetail, type RouterPlexModel } from "./models.js";

export interface ApiKeySource {
  getOrPrompt(): Promise<string | undefined>;
}

interface RouterPlexModelInformation extends vscode.LanguageModelChatInformation {
  routerPlexModel: RouterPlexModel;
}

interface ChatCompletionChunk {
  error?: { message?: string };
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
}

const CATALOG_TTL_MS = 5 * 60 * 1000;
const CONSERVATIVE_MAX_OUTPUT_TOKENS = 32768;

export class RouterPlexLanguageModelProvider
  implements vscode.LanguageModelChatProvider<RouterPlexModelInformation>, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private cachedModels: RouterPlexModel[] | undefined;
  private cacheExpiresAt = 0;
  private refreshPromise: Promise<boolean> | undefined;

  readonly onDidChangeLanguageModelChatInformation = this.changeEmitter.event;

  constructor(private readonly apiKeys: ApiKeySource) {}

  dispose(): void {
    this.changeEmitter.dispose();
  }

  refresh(): void {
    this.cachedModels = undefined;
    this.cacheExpiresAt = 0;
    this.changeEmitter.fire();
  }

  async refreshFromCatalog(force = false): Promise<boolean> {
    if (!force && this.cachedModels && Date.now() < this.cacheExpiresAt) return false;
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = this.fetchAndCacheModels();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = undefined;
    }
  }

  async listModels(force = false): Promise<RouterPlexModel[]> {
    if (force) await this.refreshFromCatalog(true);
    return this.models();
  }

  private configuration(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration("routerplex");
  }

  private async fetchAndCacheModels(): Promise<boolean> {
    const catalogUrl = this.configuration().get<string>("catalogUrl", DEFAULT_CATALOG_URL);
    const models = await fetchModels(catalogUrl);
    const changed = JSON.stringify(models) !== JSON.stringify(this.cachedModels);
    this.cachedModels = models;
    this.cacheExpiresAt = Date.now() + CATALOG_TTL_MS;
    if (changed) this.changeEmitter.fire();
    return changed;
  }

  private async models(): Promise<RouterPlexModel[]> {
    if (this.cachedModels && Date.now() < this.cacheExpiresAt) return this.cachedModels;
    try {
      await this.refreshFromCatalog();
    } catch {
      if (!this.cachedModels) this.cachedModels = fallbackModels();
      this.cacheExpiresAt = Date.now() + CATALOG_TTL_MS;
    }
    const models = this.cachedModels ?? fallbackModels();
    this.cachedModels = models;
    return models;
  }

  async provideLanguageModelChatInformation(
    _options: vscode.PrepareLanguageModelChatModelOptions,
    _token: vscode.CancellationToken,
  ): Promise<RouterPlexModelInformation[]> {
    return (await this.models()).map((model) => ({
      id: model.id,
      name: displayName(model.id),
      family: model.id,
      version: "routerplex",
      maxInputTokens: model.context_tokens ?? 128000,
      maxOutputTokens: CONSERVATIVE_MAX_OUTPUT_TOKENS,
      tooltip: `${modelPriceDetail(model)}. Billed through RouterPlex.`,
      detail: model.provider,
      capabilities: {
        imageInput: false,
        toolCalling: true,
      },
      routerPlexModel: model,
    }));
  }

  async provideLanguageModelChatResponse(
    model: RouterPlexModelInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const apiKey = await this.apiKeys.getOrPrompt();
    if (!apiKey) throw vscode.LanguageModelError.NoPermissions("A RouterPlex API key is required.");

    const request: OpenAiChatRequest = {
      model: model.id,
      messages: toOpenAiMessages(messages.map(toInternalMessage)),
      stream: true,
    };

    if (options.tools?.length) {
      request.tools = options.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema ?? { type: "object", properties: {} },
        },
      }));
      request.tool_choice = options.toolMode === vscode.LanguageModelChatToolMode.Required ? "required" : "auto";

      // GPT-5.6 Chat Completions supports function tools with effective reasoning "none".
      if (model.id.startsWith("gpt-5.6")) request.reasoning_effort = "none";
    }

    const controller = new AbortController();
    const cancellation = token.onCancellationRequested(() => controller.abort());
    try {
      const baseUrl = normalizeBaseUrl(this.configuration().get<string>("apiBaseUrl", DEFAULT_API_BASE_URL));
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) throw await languageModelError(response);
      if (!response.body) throw new Error("RouterPlex returned an empty streaming response.");

      const toolCalls = new ToolCallAccumulator();
      for await (const event of parseSseData(response.body)) {
        if (event === "[DONE]") break;
        const chunk = JSON.parse(event) as ChatCompletionChunk;
        if (chunk.error) throw new Error(chunk.error.message || "RouterPlex returned a streaming error.");
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.delta?.content) progress.report(new vscode.LanguageModelTextPart(choice.delta.content));
        toolCalls.append(choice.delta?.tool_calls);
      }

      for (const call of toolCalls.finish()) {
        progress.report(new vscode.LanguageModelToolCallPart(call.callId, call.name, call.input));
      }
    } finally {
      cancellation.dispose();
    }
  }

  async provideTokenCount(
    _model: RouterPlexModelInformation,
    value: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken,
  ): Promise<number> {
    const text = typeof value === "string" ? value : JSON.stringify(value.content);
    return Math.max(1, Math.ceil(text.length / 4));
  }
}

function toInternalMessage(message: vscode.LanguageModelChatRequestMessage): InternalChatMessage {
  const content: InternalChatPart[] = [];
  for (const part of message.content) {
    if (part instanceof vscode.LanguageModelTextPart) {
      content.push({ kind: "text", value: part.value });
    } else if (part instanceof vscode.LanguageModelToolCallPart) {
      content.push({ kind: "tool-call", callId: part.callId, name: part.name, input: part.input });
    } else if (part instanceof vscode.LanguageModelToolResultPart) {
      const value = part.content
        .map((item) => (item instanceof vscode.LanguageModelTextPart ? item.value : JSON.stringify(item)))
        .join("\n");
      content.push({ kind: "tool-result", callId: part.callId, value });
    }
  }
  return {
    role: message.role === vscode.LanguageModelChatMessageRole.Assistant ? "assistant" : "user",
    ...(message.name ? { name: message.name } : {}),
    content,
  };
}

async function languageModelError(response: Response): Promise<Error> {
  let detail = "";
  try {
    const body = (await response.json()) as { error?: { message?: string }; detail?: string };
    detail = body.error?.message || body.detail || "";
  } catch {
    detail = "";
  }
  const message = detail || `RouterPlex returned HTTP ${response.status}.`;
  if (response.status === 401 || response.status === 403) return vscode.LanguageModelError.NoPermissions(message);
  if (response.status === 402 || response.status === 429) return vscode.LanguageModelError.Blocked(message);
  if (response.status === 404) return vscode.LanguageModelError.NotFound(message);
  return new Error(message);
}
