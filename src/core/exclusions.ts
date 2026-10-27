import { normalizeRelativePath } from "../utils/path.js";

const EXCLUDED_DIR_NAMES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".context-relay",
  "node_modules",
  "bower_components",
  "vendor",
  "dist",
  "build",
  "out",
  "target",
  "coverage",
  "tmp",
  "temp",
  "secrets",
  "credentials",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".output",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".idea",
  ".vscode",
]);

const EXCLUDED_FILE_NAMES = new Set([
  "thumbs.db",
  "desktop.ini",
  ".ds_store",
]);

const SENSITIVE_FILE_PATTERNS = [
  /^\.env(?:$|\.)/i,
  /^\.npmrc$/i,
  /^\.netrc$/i,
  /^credentials(?:$|\.)/i,
  /^secrets?(?:$|\.)/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?:$|\.)/i,
  /^service[-_]?account.*\.json$/i,
  /\.(?:pem|key|p12|pfx|jks|keystore)$/i,
  /\.(?:sqlite|sqlite3|db)$/i,
];

export function isExcludedDirectoryName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    name.startsWith(".") ||
    EXCLUDED_DIR_NAMES.has(lower) ||
    EXCLUDED_DIR_NAMES.has(name)
  );
}

export function isSensitiveFileName(name: string): boolean {
  return SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

// `.trae/skills/**` is public project integration surface, so its files may be
// recorded as evidence. Hidden subdirectories and sensitive names stay blocked.
function isPublicTraeSkillPath(segments: string[]): boolean {
  return (
    segments.length > 2 &&
    segments[0]?.toLowerCase() === ".trae" &&
    segments[1]?.toLowerCase() === "skills"
  );
}

export function isExcludedPath(inputPath: string): boolean {
  const normalized = normalizeRelativePath(inputPath);
  if (normalized === ".") {
    return false;
  }

  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) {
    return false;
  }

  const directories = segments.slice(0, -1);
  const publicSkill = isPublicTraeSkillPath(segments);
  for (const directory of publicSkill ? directories.slice(2) : directories) {
    if (directory.startsWith(".") || isExcludedDirectoryName(directory)) {
      return true;
    }
  }

  const fileName = segments.at(-1) ?? "";
  return (
    fileName.startsWith(".") ||
    EXCLUDED_FILE_NAMES.has(fileName.toLowerCase()) ||
    isSensitiveFileName(fileName) ||
    isExcludedDirectoryName(fileName)
  );
}
