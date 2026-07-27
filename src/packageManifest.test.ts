import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

interface PackageManifest {
  contributes?: {
    languageModelChatProviders?: Array<{ managementCommand?: string }>;
    viewsContainers?: { activitybar?: Array<{ id?: string; icon?: string }> };
    views?: Record<string, Array<{ id?: string; type?: string }>>;
    commands?: Array<{ command?: string }>;
  };
}

test("contributes a branded RouterPlex Activity Bar webview", async () => {
  const source = await readFile(path.resolve("package.json"), "utf8");
  const manifest = JSON.parse(source) as PackageManifest;
  const contributes = manifest.contributes;
  const container = contributes?.viewsContainers?.activitybar?.find((item) => item.id === "routerplex");
  const panel = contributes?.views?.routerplex?.find((item) => item.id === "routerplex.controlPanel");
  const commands = new Set((contributes?.commands ?? []).map((item) => item.command));

  assert.equal(container?.icon, "media/routerplex.svg");
  assert.equal(panel?.type, "webview");
  assert.equal(contributes?.languageModelChatProviders?.[0]?.managementCommand, "routerplex.openPanel");
  assert.equal(commands.has("routerplex.openPanel"), true);
  assert.equal(commands.has("routerplex.openDashboard"), false);
});
