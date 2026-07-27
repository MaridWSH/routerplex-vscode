import { spawn } from "node:child_process";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface CodexAuthCommand {
  command: string;
  args: string[];
}

const CREDENTIAL_FILE = "routerplex.key";
const POSIX_HELPER = "routerplex-auth.sh";
const WINDOWS_HELPER = "routerplex-auth.ps1";

async function restrictPermissions(filePath: string, mode: number): Promise<void> {
  if (process.platform === "win32") return;
  await chmod(filePath, mode);
}

async function writeWindowsCredential(credentialPath: string, apiKey: string): Promise<void> {
  const script = [
    '$ErrorActionPreference = "Stop"',
    "$value = [Console]::In.ReadToEnd().Trim()",
    "$bytes = [Text.Encoding]::UTF8.GetBytes($value)",
    "$encrypted = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[IO.File]::WriteAllBytes($args[0], $encrypted)",
  ].join("; ");

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script, credentialPath],
      { stdio: ["pipe", "ignore", "pipe"], windowsHide: true },
    );
    let errorOutput = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      errorOutput += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(errorOutput.trim() || `PowerShell credential encryption failed with exit code ${code}.`));
    });
    child.stdin.end(apiKey.trim());
  });
}

export async function writeCredentialHelper(storagePath: string, apiKey: string): Promise<CodexAuthCommand> {
  await mkdir(storagePath, { recursive: true, mode: 0o700 });
  const credentialPath = path.join(storagePath, CREDENTIAL_FILE);

  if (process.platform === "win32") {
    await writeWindowsCredential(credentialPath, apiKey);
    const helperPath = path.join(storagePath, WINDOWS_HELPER);
    const helper = [
      "$ErrorActionPreference = \"Stop\"",
      `$credentialPath = Join-Path $PSScriptRoot ${JSON.stringify(CREDENTIAL_FILE)}`,
      "$encrypted = [IO.File]::ReadAllBytes($credentialPath)",
      "$bytes = [Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)",
      "$value = [Text.Encoding]::UTF8.GetString($bytes).Trim()",
      "if (-not $value) { throw \"RouterPlex credential is empty.\" }",
      "[Console]::Out.Write($value)",
      "",
    ].join("\r\n");
    await writeFile(helperPath, helper, "utf8");
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", helperPath],
    };
  }

  await writeFile(credentialPath, apiKey.trim(), { encoding: "utf8", mode: 0o600 });
  await restrictPermissions(credentialPath, 0o600);
  const helperPath = path.join(storagePath, POSIX_HELPER);
  const helper = [
    "#!/bin/sh",
    "set -eu",
    'helper_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
    `credential_file="$helper_dir/${CREDENTIAL_FILE}"`,
    'test -r "$credential_file"',
    'tr -d "\\r\\n" < "$credential_file"',
    "",
  ].join("\n");
  await writeFile(helperPath, helper, { encoding: "utf8", mode: 0o700 });
  await restrictPermissions(helperPath, 0o700);
  return { command: helperPath, args: [] };
}

export async function removeCredentialHelper(storagePath: string): Promise<void> {
  const targets = [CREDENTIAL_FILE, POSIX_HELPER, WINDOWS_HELPER];
  await Promise.all(targets.map((target) => rm(path.join(storagePath, target), { force: true })));
}
