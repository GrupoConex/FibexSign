import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SOURCE_ROOT = path.resolve(__dirname, "..");
const ENDPOINT = "functions/sendmailv3";
const SESSION_HEADER = "X-Parse-Session-Token";
const WINDOW_AFTER_ENDPOINT = 400;

const listSourceFiles = (directory) =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : listSourceFiles(fullPath);
    }
    return /\.(jsx?|tsx?)$/.test(entry.name) ? [fullPath] : [];
  });

const findCallSites = () =>
  listSourceFiles(SOURCE_ROOT).flatMap((file) => {
    const source = fs.readFileSync(file, "utf8");
    const sites = [];
    let index = source.indexOf(ENDPOINT);
    while (index !== -1) {
      sites.push({
        file: path.relative(SOURCE_ROOT, file),
        window: source.slice(index, index + WINDOW_AFTER_ENDPOINT)
      });
      index = source.indexOf(ENDPOINT, index + 1);
    }
    return sites;
  });

describe("sendmailv3 calls", () => {
  const sites = findCallSites();

  it("finds the known call sites", () => {
    expect(sites.length).toBeGreaterThanOrEqual(3);
  });

  it.each(sites.map((site, index) => [`${site.file}#${index}`, site]))(
    "sends the session token with the real header from %s",
    (_name, site) => {
      expect(site.window).toContain(SESSION_HEADER);
      expect(site.window).not.toMatch(/^\s*sessionToken:/m);
    }
  );
});
