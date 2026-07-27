import assert from "node:assert/strict";
import test from "node:test";

import { isNewerVersion, parseExtensionRelease } from "./updateInfo.js";

test("compares stable extension versions", () => {
  assert.equal(isNewerVersion("0.1.2", "0.1.1"), true);
  assert.equal(isNewerVersion("v1.0.0", "0.9.9"), true);
  assert.equal(isNewerVersion("0.1.1", "0.1.1"), false);
  assert.equal(isNewerVersion("0.1.0", "0.1.1"), false);
  assert.equal(isNewerVersion("0.2.0-beta.1", "0.1.1"), false);
});

test("parses the matching VSIX from a stable GitHub release", () => {
  assert.deepEqual(
    parseExtensionRelease({
      tag_name: "v0.1.2",
      html_url: "https://github.com/MaridWSH/routerplex-vscode/releases/tag/v0.1.2",
      draft: false,
      prerelease: false,
      assets: [
        {
          name: "routerplex-models-0.1.2.vsix",
          browser_download_url:
            "https://github.com/MaridWSH/routerplex-vscode/releases/download/v0.1.2/routerplex-models-0.1.2.vsix",
        },
      ],
    }),
    {
      version: "0.1.2",
      releaseUrl: "https://github.com/MaridWSH/routerplex-vscode/releases/tag/v0.1.2",
      assetName: "routerplex-models-0.1.2.vsix",
      downloadUrl:
        "https://github.com/MaridWSH/routerplex-vscode/releases/download/v0.1.2/routerplex-models-0.1.2.vsix",
    },
  );
});

test("rejects a release without its matching VSIX", () => {
  assert.throws(
    () =>
      parseExtensionRelease({
        tag_name: "v0.1.2",
        html_url: "https://github.com/MaridWSH/routerplex-vscode/releases/tag/v0.1.2",
        assets: [],
      }),
    /does not include routerplex-models-0\.1\.2\.vsix/,
  );
});
