import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

interface PackageManifest {
  contributes?: {
    languageModelChatProviders?: Array<{ vendor?: string; managementCommand?: string }>;
    viewsContainers?: { activitybar?: Array<{ id?: string; icon?: string }> };
    views?: Record<string, Array<{ id?: string; type?: string }>>;
    commands?: Array<{ command?: string }>;
    configuration?: { properties?: Record<string, unknown> };
  };
}

test("contributes a hackathon Activity Bar webview", async () => {
  const manifest = JSON.parse(await readFile(path.resolve("package.json"), "utf8")) as PackageManifest;
  const contributes = manifest.contributes;
  const container = contributes?.viewsContainers?.activitybar?.find((item) => item.id === "routerplexHackathon");
  const panel = contributes?.views?.routerplexHackathon?.find(
    (item) => item.id === "routerplexHackathon.controlPanel",
  );

  assert.equal(container?.icon, "media/routerplex.svg");
  assert.equal(panel?.type, "webview");
  assert.equal(contributes?.languageModelChatProviders?.[0]?.vendor, "routerplex-hackathon");
  assert.equal(contributes?.languageModelChatProviders?.[0]?.managementCommand, "routerplexHackathon.openPanel");
});

test("every command the panel can fire is contributed and registered", async () => {
  const manifest = JSON.parse(await readFile(path.resolve("package.json"), "utf8")) as PackageManifest;
  const contributed = new Set((manifest.contributes?.commands ?? []).map((item) => item.command));
  const sidebar = await readFile(path.resolve("src/sidebar.ts"), "utf8");
  const extension = await readFile(path.resolve("src/extension.ts"), "utf8");

  const referenced = [...sidebar.matchAll(/"(routerplexHackathon\.[A-Za-z]+)"/g)].map((match) => match[1]!);
  assert.ok(referenced.length > 5);
  for (const command of new Set(referenced)) {
    if (command === "routerplexHackathon.controlPanel") continue;
    assert.equal(contributed.has(command), true, `${command} is missing from contributes.commands`);
    assert.ok(
      extension.includes(`registerCommand("${command}"`),
      `${command} is never registered in extension.ts`,
    );
  }
});

test("settings stay under the hackathon namespace", async () => {
  const manifest = JSON.parse(await readFile(path.resolve("package.json"), "utf8")) as PackageManifest;
  const keys = Object.keys(manifest.contributes?.configuration?.properties ?? {});
  assert.ok(keys.length >= 4);
  for (const key of keys) assert.match(key, /^routerplexHackathon\./);
});
