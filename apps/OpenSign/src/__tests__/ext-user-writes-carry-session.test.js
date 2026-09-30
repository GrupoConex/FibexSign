import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SOURCE_ROOT = path.resolve(__dirname, "..");
const EXT_USER_ENDPOINT = "classes/contracts_Users";
const SESSION_HEADER = "X-Parse-Session-Token";
const WINDOW_AFTER_ENDPOINT = 700;

const listSourceFiles = (directory) =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : listSourceFiles(fullPath);
    }
    return /\.(jsx?|tsx?)$/.test(entry.name) ? [fullPath] : [];
  });

const findWriteSites = () =>
  listSourceFiles(SOURCE_ROOT).flatMap((file) => {
    const source = fs.readFileSync(file, "utf8");
    const sites = [];
    let index = source.indexOf(EXT_USER_ENDPOINT);
    while (index !== -1) {
      sites.push({
        file: path.relative(SOURCE_ROOT, file),
        window: source.slice(index, index + WINDOW_AFTER_ENDPOINT)
      });
      index = source.indexOf(EXT_USER_ENDPOINT, index + 1);
    }
    return sites;
  });

describe("contracts_Users REST writes", () => {
  const sites = findWriteSites();

  it("finds the known write sites", () => {
    expect(sites.length).toBeGreaterThanOrEqual(6);
  });

  it.each(sites.map((site) => [site.file, site]))(
    "sends the session token from %s",
    (_file, site) => {
      expect(site.window).toContain(SESSION_HEADER);
    }
  );

  it("never uses the misnamed sessionToken header", () => {
    sites.forEach((site) => {
      expect(site.window).not.toMatch(/^\s*sessionToken:/m);
    });
  });
});
