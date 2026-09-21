import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const currentFilePath = fileURLToPath(import.meta.url);
const srcRoot = path.resolve(path.dirname(currentFilePath), "..");
const notificationManagerPath = path.join(
  srcRoot,
  "utils",
  "notificationManager.js"
);

const ALERT_PATTERN = /(^|[^.\w])(window\.)?alert\(/;
const CONFIRM_PATTERN = /(^|[^.\w])(window\.)?confirm\(/;

function isExcludedDirectory(dirName) {
  return dirName === "__tests__" || dirName === "node_modules";
}

function isJsSourceFile(fileName) {
  return /\.(js|jsx)$/.test(fileName) && !/\.test\.(js|jsx)$/.test(fileName);
}

function collectSourceFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  return entries.reduce((files, entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (isExcludedDirectory(entry.name)) {
        return files;
      }
      return [...files, ...collectSourceFiles(entryPath)];
    }
    if (isJsSourceFile(entry.name)) {
      return [...files, entryPath];
    }
    return files;
  }, []);
}

function findBlockingDialogUsages(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  return lines.reduce((matches, line, index) => {
    const hasAlert = ALERT_PATTERN.test(line);
    const hasConfirm = CONFIRM_PATTERN.test(line);
    if (hasAlert || hasConfirm) {
      return [...matches, { line: index + 1, text: line.trim() }];
    }
    return matches;
  }, []);
}

describe("no blocking native dialogs", () => {
  it("does not use alert() or confirm() outside of the notification manager", () => {
    const sourceFiles = collectSourceFiles(srcRoot).filter(
      (filePath) => filePath !== notificationManagerPath
    );

    const violations = sourceFiles.reduce((accumulated, filePath) => {
      const usages = findBlockingDialogUsages(filePath);
      if (usages.length === 0) {
        return accumulated;
      }
      return [
        ...accumulated,
        { filePath: path.relative(srcRoot, filePath), usages }
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
