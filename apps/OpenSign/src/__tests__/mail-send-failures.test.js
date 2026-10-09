import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import {
  isMailRateLimitError,
  mailErrorMessageKey,
  mailSendFailureMessageKey
} from "../utils/mailErrors";
import { sendEmailToSigners } from "../constant/Utils";

vi.mock("axios");

const SOURCE_ROOT = path.resolve(__dirname, "..");
const readSource = (relativePath) =>
  fs.readFileSync(path.join(SOURCE_ROOT, relativePath), "utf8");

const rateLimitError = () => ({
  response: {
    status: 400,
    data: { code: 155, error: "Too many mail requests" }
  }
});
const forbiddenError = () => ({
  response: { status: 400, data: { code: 119, error: "Not allowed" } }
});
const sentResponse = () => ({ data: { result: { status: "success" } } });

const buildPdfDetails = () => [
  {
    objectId: "doc1",
    Name: "Contract",
    createdAt: "2026-01-01T00:00:00.000Z",
    ExpiryDate: { iso: "2026-02-01T00:00:00.000Z" },
    SendinOrder: false,
    ExtUserPtr: {
      objectId: "ext1",
      Name: "Owner",
      Email: "owner@x.com",
      Company: "Acme"
    }
  }
];

const buildSigners = () => [
  { objectId: "s1", Email: "a@x.com", Name: "A" },
  { objectId: "s2", Email: "b@x.com", Name: "B" },
  { objectId: "s3", Email: "c@x.com", Name: "C" }
];

const send = () =>
  sendEmailToSigners(buildPdfDetails(), buildSigners(), null, null, false);

describe("mail error helpers", () => {
  it("detects the Parse 155 code and HTTP 429 as rate limiting", () => {
    expect(isMailRateLimitError(rateLimitError())).toBe(true);
    expect(isMailRateLimitError({ response: { status: 429, data: {} } })).toBe(
      true
    );
    expect(isMailRateLimitError(forbiddenError())).toBe(false);
    expect(isMailRateLimitError(undefined)).toBe(false);
  });

  it("maps errors to existing or new translation keys", () => {
    expect(mailErrorMessageKey(rateLimitError())).toBe("mail-rate-limited");
    expect(mailErrorMessageKey(forbiddenError())).toBe(
      "something-went-wrong-mssg"
    );
  });

  it("maps send results to translation keys", () => {
    expect(mailSendFailureMessageKey({ rateLimited: true })).toBe(
      "mail-rate-limited"
    );
    expect(mailSendFailureMessageKey({ status: "failed" })).toBe("mail-failed");
    expect(mailSendFailureMessageKey(undefined)).toBe("mail-failed");
  });
});

describe("sendEmailToSigners failure reporting", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.setItem("baseUrl", "https://api.test/");
    localStorage.setItem("parseAppId", "app");
    localStorage.setItem("accesstoken", "token");
    vi.spyOn(console, "log").mockImplementation(() => {});
    axios.put.mockResolvedValue({});
  });

  it("returns success when every signer was mailed", async () => {
    axios.post.mockResolvedValue(sentResponse());

    const result = await send();

    expect(result).toEqual({ status: "success" });
    expect(axios.post).toHaveBeenCalledTimes(3);
  });

  it("reports failure when the last send fails even if earlier ones succeeded", async () => {
    axios.post
      .mockResolvedValueOnce(sentResponse())
      .mockResolvedValueOnce(sentResponse())
      .mockRejectedValueOnce(forbiddenError());

    const result = await send();

    expect(result).toEqual({
      status: "failed",
      failedCount: 1,
      sentCount: 2,
      rateLimited: false
    });
  });

  it("reports failure when an earlier send fails and the last one succeeds", async () => {
    axios.post
      .mockRejectedValueOnce(forbiddenError())
      .mockResolvedValue(sentResponse());

    const result = await send();

    expect(result.status).toBe("failed");
    expect(result.failedCount).toBe(1);
  });

  it("flags rate limiting when any send was answered with 155", async () => {
    axios.post
      .mockResolvedValueOnce(sentResponse())
      .mockRejectedValue(rateLimitError());

    const result = await send();

    expect(result).toEqual({
      status: "failed",
      failedCount: 2,
      sentCount: 1,
      rateLimited: true
    });
  });

  it("counts a non success result status as a failure and keeps its status", async () => {
    axios.post.mockResolvedValue({
      data: { result: { status: "quota-reached" } }
    });

    const result = await send();

    expect(result.status).toBe("quota-reached");
    expect(result.failedCount).toBe(3);
  });

  it("counts an error status answer as a failure", async () => {
    axios.post.mockResolvedValue({ data: { result: { status: "error" } } });

    const result = await send();

    expect(result.status).toBe("failed");
    expect(result.sentCount).toBe(0);
  });

  it("marks the document as sent when at least one mail went out", async () => {
    axios.post
      .mockResolvedValueOnce(sentResponse())
      .mockRejectedValue(forbiddenError());

    await send();

    expect(axios.put).toHaveBeenCalledTimes(1);
  });

  it("does not mark the document as sent when nothing went out", async () => {
    axios.post.mockRejectedValue(forbiddenError());

    await send();

    expect(axios.put).not.toHaveBeenCalled();
  });
});

describe("callers surface mail failures", () => {
  it("CustomizeMail shows an error toast for failed sends", () => {
    const source = readSource("components/pdf/CustomizeMail.jsx");

    expect(source).toContain("mailSendFailureMessageKey");
    expect(source).toMatch(/notify\.error\(\s*t\(mailSendFailureMessageKey/);
  });

  it.each([
    ["reports/document/DocumentsReport.jsx"],
    ["reports/template/TemplatesReport.jsx"]
  ])("%s resend maps errors to a visible message", (file) => {
    const source = readSource(file);

    expect(source).toContain("mailErrorMessageKey(err)");
  });
});
