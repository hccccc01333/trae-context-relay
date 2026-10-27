export const TOOL_NAME = "context-relay";
export const TOOL_VERSION = "0.2.0";
export const SNAPSHOT_SCHEMA_VERSION = 1;

export const DATA_DIR_NAME = ".context-relay";
export const SNAPSHOTS_DIR_NAME = "snapshots";
export const HANDOFF_FILE_NAME = "HANDOFF.md";
export const STORE_GITIGNORE = [
  "# ContextRelay state is local and private by default.",
  "# Remove this file if you intentionally want to commit a snapshot.",
  "*",
  "",
].join("\n");

export const MAX_EVIDENCE_FILES = 40;
export const MAX_EVIDENCE_FILE_BYTES = 1024 * 1024;
export const MAX_TREE_ENTRIES = 250;
export const MAX_TREE_DEPTH = 4;
export const MAX_GIT_PATHS = 200;
export const MAX_COMMITTED_PATHS = 200;
export const MAX_INPUT_FILE_BYTES = 256 * 1024;
export const MAX_NOTES = 50;

export const FUNCTIONAL_VERIFICATION_NOTE =
  "File and Git evidence proves only that recorded files existed with a matching hash at capture time. It does not prove that tests passed, a feature works, or code quality is acceptable.";
