import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const srcDir = path.resolve(__dirname, "..");

const socialMediaPath = path.join(srcDir, "components", "SocialMedia.jsx");
const addAdminPath = path.join(srcDir, "pages", "AddAdmin.jsx");
const updateExistUserAdminPath = path.join(
  srcDir,
  "pages",
  "UpdateExistUserAdmin.jsx"
);
const appInfoPath = path.join(srcDir, "constant", "appinfo.js");
const shareButtonPath = path.join(srcDir, "primitives", "ShareButton.jsx");

describe("no external support/community links remain", () => {
  it("does not ship a SocialMedia component with external links", () => {
    const exists = fs.existsSync(socialMediaPath);
    if (exists) {
      const content = fs.readFileSync(socialMediaPath, "utf-8");
      expect(content).not.toMatch(/github\.com/);
      expect(content).not.toMatch(/discord\.com/);
      expect(content).not.toMatch(/twitter\.com/);
      expect(content).not.toMatch(/linkedin\.com/);
    } else {
      expect(exists).toBe(false);
    }
  });

  it("does not link to Discord from AddAdmin", () => {
    const content = fs.readFileSync(addAdminPath, "utf-8");
    expect(content).not.toMatch(/discord\.com/);
  });

  it("does not link to Discord from UpdateExistUserAdmin", () => {
    const content = fs.readFileSync(updateExistUserAdminPath, "utf-8");
    expect(content).not.toMatch(/discord\.com/);
  });

  it("does not define a supportEmail in appInfo", () => {
    const content = fs.readFileSync(appInfoPath, "utf-8");
    expect(content).not.toMatch(/supportEmail/);
  });

  it("does not ship the social-share ShareButton primitive", () => {
    expect(fs.existsSync(shareButtonPath)).toBe(false);
  });
});
