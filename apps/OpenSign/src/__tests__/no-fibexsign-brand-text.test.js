import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const currentFilePath = fileURLToPath(import.meta.url);
const srcRoot = path.resolve(path.dirname(currentFilePath), "..");
const appRoot = path.resolve(srcRoot, "..");

const SCAN_TARGETS = [
  srcRoot,
  path.join(appRoot, "public"),
  path.join(appRoot, "examples")
];

const EXTRA_FILES = [path.join(appRoot, "index.html")];

const EXCLUDED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  "__tests__"
]);

const SCANNED_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".css",
  ".json",
  ".html",
  ".svg"
]);

const BRAND_TEXT_PATTERN = /FibexSign|fibex-sign/;
const ALLOWED_URL_OR_EMAIL_PATTERN = /fibexsign\.com|@fibexsign\.com/i;

function isScannableFile(fileName) {
  return SCANNED_EXTENSIONS.has(path.extname(fileName));
}

function collectFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  return entries.reduce((files, entry) => {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRECTORIES.has(entry.name)) {
        return files;
      }
      return [...files, ...collectFiles(path.join(directory, entry.name))];
    }
    if (isScannableFile(entry.name)) {
      return [...files, path.join(directory, entry.name)];
    }
    return files;
  }, []);
}

function findBrandTextViolations(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  return lines.reduce((matches, line, index) => {
    const hasBrandText = BRAND_TEXT_PATTERN.test(line);
    const isAllowedUrlOrEmail = ALLOWED_URL_OR_EMAIL_PATTERN.test(line);
    if (hasBrandText && !isAllowedUrlOrEmail) {
      return [...matches, { line: index + 1, text: line.trim() }];
    }
    return matches;
  }, []);
}

describe("no FibexSign brand text remains", () => {
  it("does not reference the retired 'FibexSign' brand name outside of the fibexsign.com domain/email", () => {
    const sourceFiles = [
      ...SCAN_TARGETS.flatMap((target) =>
        fs.existsSync(target) ? collectFiles(target) : []
      ),
      ...EXTRA_FILES.filter((filePath) => fs.existsSync(filePath))
    ];

    const violations = sourceFiles.reduce((accumulated, filePath) => {
      const usages = findBrandTextViolations(filePath);
      if (usages.length === 0) {
        return accumulated;
      }
      return [
        ...accumulated,
        { filePath: path.relative(appRoot, filePath), usages }
      ];
    }, []);

    const violationReport = violations
      .map(
        (violation) =>
          `${violation.filePath}: ${violation.usages
            .map((usage) => `line ${usage.line} -> ${usage.text}`)
            .join(", ")}`
      )
      .join("\n");

    expect(violationReport).toBe("");
  });
});
