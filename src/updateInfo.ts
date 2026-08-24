export interface ExtensionRelease {
  version: string;
  releaseUrl: string;
  assetName: string;
  downloadUrl: string;
}

const RELEASE_DOWNLOAD_PREFIX = "https://github.com/MaridWSH/routerplex-vscode/releases/download/";

// Hackathon builds ship under their own tag so the public RouterPlex extension
// keeps `releases/latest` to itself and never offers a participant build.
export const HACKATHON_TAG_PREFIX = "hackathon-v";

function stableVersionParts(value: string): [number, number, number] | undefined {
  const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function hackathonVersion(tag: unknown): string | undefined {
  if (typeof tag !== "string" || !tag.startsWith(HACKATHON_TAG_PREFIX)) return undefined;
  const version = tag.slice(HACKATHON_TAG_PREFIX.length);
  return stableVersionParts(version) ? version : undefined;
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

interface GitHubRelease {
  tag_name?: unknown;
  html_url?: unknown;
  draft?: unknown;
  assets?: unknown;
}

/**
 * Picks the highest hackathon release from a releases listing. Prereleases are
 * kept - every hackathon build is published as one - but drafts are not.
 */
export function parseHackathonRelease(value: unknown): ExtensionRelease {
  if (!Array.isArray(value)) throw new Error("GitHub returned an invalid releases response.");

  let best: { release: GitHubRelease; version: string } | undefined;
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const release = entry as GitHubRelease;
    if (release.draft === true) continue;
    const version = hackathonVersion(release.tag_name);
    if (!version) continue;
    if (!best || isNewerVersion(version, best.version)) best = { release, version };
  }
  if (!best) throw new Error("GitHub has no published hackathon release.");

  const { release, version } = best;
  if (typeof release.html_url !== "string" || !release.html_url.startsWith("https://github.com/MaridWSH/")) {
    throw new Error("The hackathon release URL is invalid.");
  }

  const assetName = `routerplex-hackathon-${version}.vsix`;
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const asset = assets.find((candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    return (candidate as { name?: unknown }).name === assetName;
  }) as { name?: unknown; browser_download_url?: unknown } | undefined;

  if (
    !asset ||
    typeof asset.browser_download_url !== "string" ||
    !asset.browser_download_url.startsWith(RELEASE_DOWNLOAD_PREFIX)
  ) {
    throw new Error(`The hackathon release does not include ${assetName}.`);
  }

  return {
    version,
    releaseUrl: release.html_url,
    assetName,
    downloadUrl: asset.browser_download_url,
  };
}
