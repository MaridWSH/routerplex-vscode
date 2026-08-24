import assert from "node:assert/strict";
import test from "node:test";

import { hackathonVersion, isNewerVersion, parseHackathonRelease } from "./updateInfo.js";

const release = (version: string, withAsset = true) => ({
  tag_name: `hackathon-v${version}`,
  html_url: `https://github.com/MaridWSH/routerplex-vscode/releases/tag/hackathon-v${version}`,
  draft: false,
  prerelease: true,
  assets: withAsset
    ? [
        {
          name: `routerplex-hackathon-${version}.vsix`,
          browser_download_url: `https://github.com/MaridWSH/routerplex-vscode/releases/download/hackathon-v${version}/routerplex-hackathon-${version}.vsix`,
        },
      ]
    : [],
});

test("only recognises hackathon tags", () => {
  assert.equal(hackathonVersion("hackathon-v1.2.3"), "1.2.3");
  assert.equal(hackathonVersion("v0.1.4"), undefined);
  assert.equal(hackathonVersion("hackathon-v1.2"), undefined);
});

test("compares stable versions", () => {
  assert.equal(isNewerVersion("1.2.0", "1.1.9"), true);
  assert.equal(isNewerVersion("1.1.0", "1.1.0"), false);
  assert.equal(isNewerVersion("1.0.0", "1.1.0"), false);
});

test("picks the highest hackathon release and ignores the public extension", () => {
  const parsed = parseHackathonRelease([
    { tag_name: "v0.1.4", html_url: "https://github.com/MaridWSH/routerplex-vscode/releases/tag/v0.1.4", assets: [] },
    release("1.1.0"),
    release("1.2.0"),
  ]);
  assert.equal(parsed.version, "1.2.0");
  assert.equal(parsed.assetName, "routerplex-hackathon-1.2.0.vsix");
});

test("skips drafts", () => {
  const parsed = parseHackathonRelease([{ ...release("2.0.0"), draft: true }, release("1.1.0")]);
  assert.equal(parsed.version, "1.1.0");
});

test("rejects a release without its VSIX", () => {
  assert.throws(
    () => parseHackathonRelease([release("1.1.0", false)]),
    /does not include routerplex-hackathon-1\.1\.0\.vsix/,
  );
});

test("rejects a listing with no hackathon release", () => {
  assert.throws(() => parseHackathonRelease([]), /no published hackathon release/);
});
