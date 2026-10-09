import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SOURCE_ROOT = path.resolve(__dirname, "..");
const ENDPOINT = "functions/sendmailv3";
const REQUEST_CALL = "axios.post(url, params";

const readSource = (relativePath) =>
  fs.readFileSync(path.join(SOURCE_ROOT, relativePath), "utf8");

const paramsSection = (relativePath) => {
  const source = readSource(relativePath);
  const start = source.indexOf(ENDPOINT);
  const end = source.indexOf(REQUEST_CALL, start);
  return source.slice(start, end);
};

describe("sendmailv3 callers send the document id", () => {
  it("sendEmailToSigners sends the id of the document being mailed", () => {
    const section = paramsSection("constant/Utils.js");

    expect(section).toMatch(/docId:\s*pdfDetails\?\.\[0\]\?\.objectId/);
  });

  it("DocumentsReport resend sends the id of the document", () => {
    const section = paramsSection("reports/document/DocumentsReport.jsx");

    expect(section).toMatch(/docId:\s*doc\?\.objectId/);
    expect(section).not.toContain("docClass");
  });

  it("TemplatesReport resend sends the template id and its class", () => {
    const section = paramsSection("reports/template/TemplatesReport.jsx");

    expect(section).toMatch(/docId:\s*doc\?\.objectId/);
    expect(section).toMatch(/docClass:\s*"contracts_Template"/);
  });

  it("every caller still sends the session token header", () => {
    const files = [
      "constant/Utils.js",
      "reports/document/DocumentsReport.jsx",
      "reports/template/TemplatesReport.jsx"
    ];

    files.forEach((file) => {
      expect(paramsSection(file)).toContain("X-Parse-Session-Token");
    });
  });
});
