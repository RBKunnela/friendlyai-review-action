import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const trackedFiles = execFileSync("git", ["ls-files"], {
  encoding: "utf8",
})
  .split(/\r?\n/)
  .filter(Boolean);

const forbiddenPaths = [
  ".aios/",
  ".claude/",
  "prompts/",
  "docs/AGENTS.md",
  "docs/ARCHITECTURE.md",
];

function literalRegex(charCodes, flags = "i") {
  const escaped = String.fromCharCode(...charCodes).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  return new RegExp(escaped, flags);
}

const forbiddenTerms = [
  literalRegex([115, 105, 110, 107, 114, 97]),
  literalRegex([115, 121, 110, 107, 114, 97]),
  literalRegex([65, 73, 79, 88]),
  literalRegex([57, 45, 97, 103, 101, 110, 116]),
  literalRegex([99, 111, 117, 110, 99, 105, 108]),
  literalRegex([118, 101, 116, 111, 32, 116, 114, 105, 103, 103, 101, 114]),
  literalRegex([112, 101, 114, 115, 111, 110, 97, 32, 112, 114, 111, 109, 112, 116]),
  literalRegex([97, 103, 101, 110, 116, 32, 112, 114, 111, 109, 112, 116]),
  literalRegex([122, 97, 105, 45, 97, 112, 105, 45, 107, 101, 121]),
  literalRegex([108, 108, 109, 45, 97, 112, 105, 45, 107, 101, 121]),
];

const secretPatterns = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /ghp_[A-Za-z0-9_]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

const textFileExtensions = new Set([
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".ts",
  ".yml",
  ".yaml",
]);

const failures = [];

for (const file of trackedFiles) {
  const normalized = file.replace(/\\/g, "/");
  if (!existsSync(file)) {
    continue;
  }

  if (forbiddenPaths.some((path) => normalized.startsWith(path) || normalized === path)) {
    failures.push(`forbidden tracked path: ${file}`);
  }

  if (normalized === "package-lock.json" || normalized === "dist/licenses.txt") {
    continue;
  }

  const extension = normalized.slice(normalized.lastIndexOf("."));
  if (!textFileExtensions.has(extension)) {
    continue;
  }

  const content = readFileSync(file, "utf8");
  for (const pattern of forbiddenTerms) {
    if (pattern.test(content)) {
      failures.push(`forbidden public-surface term ${pattern} in ${file}`);
    }
  }
  for (const pattern of secretPatterns) {
    if (pattern.test(content)) {
      failures.push(`credential-shaped value ${pattern} in ${file}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("public surface check passed");
