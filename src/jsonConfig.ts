import { chmod, copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { applyEdits, modify, parse, printParseErrorCode, type ParseError } from "jsonc-parser";

export type JsonObject = Record<string, unknown>;

export function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function readOptional(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

export function parseJsonObject(source: string, filePath: string): JsonObject {
  if (!source.trim()) return {};
  const errors: ParseError[] = [];
  const value: unknown = parse(source, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length) {
    const first = errors[0]!;
    throw new Error(`Cannot parse ${filePath}: ${printParseErrorCode(first.error)} at offset ${first.offset}.`);
  }
  if (!isJsonObject(value)) throw new Error(`Expected a JSON object in ${filePath}.`);
  return value;
}

export function setJsoncValue(source: string, jsonPath: (string | number)[], value: unknown): string {
  const input = source.trim() ? source : "{}\n";
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  return applyEdits(
    input,
    modify(input, jsonPath, value, {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol },
    }),
  );
}

export function setJsoncValues(
  source: string,
  values: Array<{ path: (string | number)[]; value: unknown }>,
): string {
  return values.reduce((content, entry) => setJsoncValue(content, entry.path, entry.value), source);
}

export async function writePrivateFile(filePath: string, content: string): Promise<void> {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, content.endsWith("\n") ? content : `${content}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    if (process.platform !== "win32") await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, filePath);
    if (process.platform !== "win32") await chmod(filePath, 0o600);
  } finally {
    await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

export async function backupExistingFile(filePath: string): Promise<string | undefined> {
  const source = await readOptional(filePath);
  if (!source) return undefined;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${filePath}.routerplex-hackathon-backup-${timestamp}`;
  await copyFile(filePath, backupPath);
  if (process.platform !== "win32") await chmod(backupPath, 0o600);
  return backupPath;
}
