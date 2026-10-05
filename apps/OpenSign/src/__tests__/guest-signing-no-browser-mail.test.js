import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const readPage = (name) =>
  fs.readFileSync(path.resolve(__dirname, "..", "pages", name), "utf8");

describe("guest signing flow", () => {
  it("does not send the next signer email from the browser", () => {
    const source = readPage("PdfRequestFiles.jsx");

    expect(source).not.toContain("functions/sendmailv3");
  });

  it("passes the sendmail query flag to the signPdf cloud function", () => {
    const source = readPage("PdfRequestFiles.jsx");

    expect(source).toMatch(/sendmail !== "false"/);
    expect(source).toMatch(
      /signPdfFun\([\s\S]*?"Signed",[\s\S]*?sendmail !== "false"/
    );
  });
});
