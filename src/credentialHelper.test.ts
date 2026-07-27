import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { writeCredentialHelper } from "./credentialHelper.js";

const execFileAsync = promisify(execFile);

test("POSIX credential helper returns the stored token with restricted permissions", { skip: process.platform === "win32" }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "routerplex-auth-test-"));
  try {
    const auth = await writeCredentialHelper(directory, "sk-test-routerplex");
    const result = await execFileAsync(auth.command, auth.args);
    const credential = await stat(path.join(directory, "routerplex.key"));
    const helper = await stat(auth.command);

    assert.equal(result.stdout, "sk-test-routerplex");
    assert.equal(credential.mode & 0o777, 0o600);
    assert.equal(helper.mode & 0o777, 0o700);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
