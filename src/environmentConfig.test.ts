import assert from "node:assert/strict";
import test from "node:test";

import { applyManagedEnvironment, environmentExportLine, removeManagedEnvironment } from "./environmentConfig.js";

test("adds and replaces a managed POSIX export", () => {
  const first = applyManagedEnvironment("export PATH=/usr/bin\n", "ROUTERPLEX_HACKATHON_API_KEY", "sk-first", "posix");
  const second = applyManagedEnvironment(first, "ROUTERPLEX_HACKATHON_API_KEY", "sk-second", "posix");

  assert.match(second, /export ROUTERPLEX_HACKATHON_API_KEY='sk-second'/);
  assert.doesNotMatch(second, /sk-first/);
  assert.equal((second.match(/RouterPlex Hackathon managed environment/g) ?? []).length, 2);
});

test("writes fish syntax when needed", () => {
  assert.equal(
    environmentExportLine("ROUTERPLEX_HACKATHON_API_KEY", "sk-test", "fish"),
    "set -gx ROUTERPLEX_HACKATHON_API_KEY 'sk-test'",
  );
});

test("removes only the managed environment block", () => {
  const source = applyManagedEnvironment("export EXISTING=value\n", "ROUTERPLEX_HACKATHON_API_KEY", "sk-test", "posix");
  assert.equal(removeManagedEnvironment(source), "export EXISTING=value\n");
});
