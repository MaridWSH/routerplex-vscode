import * as vscode from "vscode";

import { normalizeBaseUrl, type OpenAiChatRequest } from "./api.js";
import {
  parseSseData,
  ToolCallAccumulator,
  toOpenAiMessages,
  type InternalChatMessage,
  type InternalChatPart,
} from "./chatProtocol.js";
import { DEFAULT_CATALOG_URL, MAX_OUTPUT_TOKENS } from "./constants.js";
import { displayName, fallbackModels, fetchModels, modelPriceDetail, type HackathonModel } from "./models.js";
import type { SessionStore } from "./session.js";

export interface ApiKeySource {
  getOrPrompt(): Promise<string | undefined>;
}

interface HackathonModelInformation extends vscode.LanguageModelChatInformation {
  hackathonModel: HackathonModel;
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

export class HackathonModelProvider
  implements vscode.LanguageModelChatProvider<HackathonModelInformation>, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private cachedModels: HackathonModel[] | undefined;
  private cacheExpiresAt = 0;
  private refreshPromise: Promise<boolean> | undefined;

  readonly onDidChangeLanguageModelChatInformation = this.changeEmitter.event;

  constructor(private readonly sessions: SessionStore) {}

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

  async listModels(force = false): Promise<HackathonModel[]> {
    if (force) await this.refreshFromCatalog(true);
    return this.models();
  }

  private configuration(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration("routerplexHackathon");
  }

  private async roster(): Promise<string[]> {
    return (await this.sessions.get())?.models ?? [];
  }

  private async fetchAndCacheModels(): Promise<boolean> {
    const roster = await this.roster();
    if (roster.length === 0) {
      const changed = this.cachedModels !== undefined && this.cachedModels.length > 0;
      this.cachedModels = [];
      this.cacheExpiresAt = Date.now() + CATALOG_TTL_MS;
      if (changed) this.changeEmitter.fire();
      return changed;
    }

    const catalogUrl = this.configuration().get<string>("catalogUrl", DEFAULT_CATALOG_URL);
    const models = await fetchModels(catalogUrl, roster);
    const changed = JSON.stringify(models) !== JSON.stringify(this.cachedModels);
    this.cachedModels = models;
    this.cacheExpiresAt = Date.now() + CATALOG_TTL_MS;
    if (changed) this.changeEmitter.fire();
    return changed;
  }

  private async models(): Promise<HackathonModel[]> {
    if (this.cachedModels && Date.now() < this.cacheExpiresAt) return this.cachedModels;
    try {
      await this.refreshFromCatalog();
    } catch {
      // Venue wifi lost the catalog. The roster still came from the console, so
      // show it with baked-in pricing rather than an empty model picker.
      if (!this.cachedModels) this.cachedModels = fallbackModels(await this.roster());
      this.cacheExpiresAt = Date.now() + CATALOG_TTL_MS;
    }
    const models = this.cachedModels ?? fallbackModels(await this.roster());
    this.cachedModels = models;
    return models;
  }

  async provideLanguageModelChatInformation(
    _options: vscode.PrepareLanguageModelChatModelOptions,
    _token: vscode.CancellationToken,
  ): Promise<HackathonModelInformation[]> {
    const session = await this.sessions.get();
    if (!session) return [];
    return (await this.models()).map((model) => ({
      id: model.id,
      name: displayName(model.id),
      family: model.id,
      version: "hackathon",
      maxInputTokens: model.context_tokens ?? 128000,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      tooltip: `${modelPriceDetail(model)}. Billed to ${session.teamName}.`,
      detail: session.teamName,
      capabilities: {
        imageInput: model.vision,
        toolCalling: true,
      },
      hackathonModel: model,
    }));
  }

  async provideLanguageModelChatResponse(
    model: HackathonModelInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const session = await this.sessions.get();
    if (!session) {
      throw vscode.LanguageModelError.NoPermissions("Join the hackathon with your team code first.");
    }

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
    }

    const controller = new AbortController();
    const cancellation = token.onCancellationRequested(() => controller.abort());
    try {
      const response = await fetch(`${normalizeBaseUrl(session.baseUrl)}/chat/completions`, {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          Authorization: `Bearer ${session.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) throw await gatewayError(response);
      if (!response.body) throw new Error("The hackathon gateway returned an empty streaming response.");

      const toolCalls = new ToolCallAccumulator();
      for await (const event of parseSseData(response.body)) {
        if (event === "[DONE]") break;
        const chunk = JSON.parse(event) as ChatCompletionChunk;
        if (chunk.error) throw new Error(chunk.error.message || "The hackathon gateway returned a streaming error.");
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
    _model: HackathonModelInformation,
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
    } else {
      const image = asImagePart(part);
      if (image) {
        content.push({
          kind: "image",
          mimeType: image.mimeType,
          base64: Buffer.from(image.data).toString("base64"),
        });
      }
    }
  }
  return {
    role: message.role === vscode.LanguageModelChatMessageRole.Assistant ? "assistant" : "user",
    ...(message.name ? { name: message.name } : {}),
    content,
  };
}

// Chat attachments arrive as LanguageModelDataPart. Duck-typing rather than an
// instanceof keeps this working across the VS Code versions in the room, and
// drops non-image data (a pasted text file, say) that the models cannot read.
function asImagePart(part: unknown): { mimeType: string; data: Uint8Array } | undefined {
  const candidate = part as { mimeType?: unknown; data?: unknown } | null;
  if (!candidate || typeof candidate.mimeType !== "string") return undefined;
  if (!candidate.mimeType.startsWith("image/")) return undefined;
  if (!(candidate.data instanceof Uint8Array)) return undefined;
  return { mimeType: candidate.mimeType, data: candidate.data };
}

async function gatewayError(response: Response): Promise<Error> {
  let detail = "";
  try {
    const body = (await response.json()) as { error?: { message?: string }; detail?: string };
    detail = body.error?.message || body.detail || "";
  } catch {
    detail = "";
  }
  if (/budget/i.test(detail)) {
    return vscode.LanguageModelError.Blocked(`${detail} Ask an organiser to top the team up.`);
  }
  const message = detail || `The hackathon gateway returned HTTP ${response.status}.`;
  if (response.status === 401 || response.status === 403) return vscode.LanguageModelError.NoPermissions(message);
  if (response.status === 402 || response.status === 429) return vscode.LanguageModelError.Blocked(message);
  if (response.status === 404) return vscode.LanguageModelError.NotFound(message);
  return new Error(message);
}
