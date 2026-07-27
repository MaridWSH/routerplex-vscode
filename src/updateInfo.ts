export interface ExtensionRelease {
  version: string;
  releaseUrl: string;
  assetName: string;
  downloadUrl: string;
}

const RELEASE_DOWNLOAD_PREFIX = "https://github.com/MaridWSH/routerplex-vscode/releases/download/";

function stableVersionParts(value: string): [number, number, number] | undefined {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const candidateParts = stableVersionParts(candidate);
  const currentParts = stableVersionParts(current);
  if (!candidateParts || !currentParts) return false;

  for (let index = 0; index < candidateParts.length; index += 1) {
    if (candidateParts[index] !== currentParts[index]) {
      return candidateParts[index]! > currentParts[index]!;
    }
  }
  return false;
}

export function parseExtensionRelease(value: unknown): ExtensionRelease {
  if (!value || typeof value !== "object") throw new Error("GitHub returned an invalid release response.");
  const release = value as {
    tag_name?: unknown;
    html_url?: unknown;
    draft?: unknown;
    prerelease?: unknown;
    assets?: unknown;
  };
  if (release.draft === true || release.prerelease === true) {
    throw new Error("GitHub returned a draft or prerelease instead of the latest stable release.");
  }
  if (typeof release.tag_name !== "string" || !stableVersionParts(release.tag_name)) {
    throw new Error("The latest RouterPlex release does not have a stable semantic version tag.");
  }
  if (typeof release.html_url !== "string" || !release.html_url.startsWith("https://github.com/MaridWSH/")) {
    throw new Error("The latest RouterPlex release URL is invalid.");
  }

  const version = release.tag_name.replace(/^v/, "");
  const assetName = `routerplex-models-${version}.vsix`;
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const asset = assets.find((candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    return (candidate as { name?: unknown }).name === assetName;
  }) as { name?: unknown; browser_download_url?: unknown } | undefined;

  if (
    !asset ||
    typeof asset.name !== "string" ||
    typeof asset.browser_download_url !== "string" ||
    !asset.browser_download_url.startsWith(RELEASE_DOWNLOAD_PREFIX)
  ) {
    throw new Error(`The latest RouterPlex release does not include ${assetName}.`);
  }

  return {
    version,
    releaseUrl: release.html_url,
    assetName,
    downloadUrl: asset.browser_download_url,
  };
}
