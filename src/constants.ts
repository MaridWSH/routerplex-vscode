export const HACKATHON_VENDOR = "routerplex-hackathon";
export const SESSION_SECRET_KEY = "routerplex.hackathon.session";

export const DEFAULT_CONSOLE_URL = "https://hackathon.routerplex.com";
export const DEFAULT_API_BASE_URL = "https://hackathon.routerplex.com/v1";
export const DEFAULT_CATALOG_URL = "https://routerplex.com/api/models";
export const DEFAULT_CODEX_MODEL = "mimo-v2.5-pro";

// Deliberately not ROUTERPLEX_API_KEY: a participant may also run the public
// RouterPlex extension, and the two keys bill to different accounts.
export const HACKATHON_ENV_KEY = "ROUTERPLEX_HACKATHON_API_KEY";

export const CREDIT_REFRESH_MS = 30_000;

export const CODEX_MANAGED_STATE_KEY = "routerplex.hackathon.codex.managed";
export const CODEX_PREVIOUS_ROOT_STATE_KEY = "routerplex.hackathon.codex.previousRootAssignments";
export const CODEX_LAST_MODEL_STATE_KEY = "routerplex.hackathon.codex.lastModel";
export const CODEX_LAST_BACKUP_STATE_KEY = "routerplex.hackathon.codex.lastBackup";
export const CODEX_ENV_PROFILE_STATE_KEY = "routerplex.hackathon.codex.environmentProfile";
export const CODEX_PREVIOUS_ENV_STATE_KEY = "routerplex.hackathon.codex.previousEnvironmentValue";

export const OPENCODE_MANAGED_STATE_KEY = "routerplex.hackathon.opencode.managed";
export const OPENCODE_PREVIOUS_SECRET_KEY = "routerplex.hackathon.opencode.previous";

export const CLAUDE_MANAGED_STATE_KEY = "routerplex.hackathon.claude.managed";
export const CLAUDE_PREVIOUS_SECRET_KEY = "routerplex.hackathon.claude.previous";
