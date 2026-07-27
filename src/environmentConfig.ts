export const ENVIRONMENT_START = "# >>> RouterPlex managed environment";
export const ENVIRONMENT_END = "# <<< RouterPlex managed environment";

export type ShellSyntax = "posix" | "fish";

function removeManagedLines(lines: string[]): string[] {
  const result: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (line.trim() === ENVIRONMENT_START) {
      skipping = true;
      continue;
    }
    if (skipping && line.trim() === ENVIRONMENT_END) {
      skipping = false;
      continue;
    }
    if (!skipping) result.push(line);
  }
  return result;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function environmentExportLine(variable: string, value: string, syntax: ShellSyntax): string {
  if (syntax === "fish") return `set -gx ${variable} ${shellQuote(value)}`;
  return `export ${variable}=${shellQuote(value)}`;
}

export function applyManagedEnvironment(
  source: string,
  variable: string,
  value: string,
  syntax: ShellSyntax,
): string {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const cleaned = removeManagedLines(source.replace(/\r\n/g, "\n").split("\n")).join("\n").trimEnd();
  const block = [
    ENVIRONMENT_START,
    environmentExportLine(variable, value, syntax),
    ENVIRONMENT_END,
  ].join("\n");
  return `${cleaned ? `${cleaned}\n\n` : ""}${block}\n`.replace(/\n/g, newline);
}

export function removeManagedEnvironment(source: string): string {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const cleaned = removeManagedLines(source.replace(/\r\n/g, "\n").split("\n")).join("\n").trimEnd();
  return (cleaned ? `${cleaned}\n` : "").replace(/\n/g, newline);
}
