import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import Parse from "parse";
import { signPdfFun } from "../Utils";

vi.mock("axios", () => ({ default: { post: vi.fn() } }));

vi.mock("../../i18n", () => ({
  default: { t: (key) => key, language: "en" }
}));

const SUCCESS = { status: "success", data: "https://files.test/signed.pdf" };

const signWith = (sendNextMail) =>
  signPdfFun(
    "base64pdf",
    "doc1",
    "contact1",
    "owner1",
    [],
    "Signed",
    sendNextMail
  );

describe("signPdfFun", () => {
  let runSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("baseUrl", "https://server.test/");
    localStorage.setItem("parseAppId", "app-id");
    axios.post.mockResolvedValue({ data: { result: {} } });
    runSpy = vi.spyOn(Parse.Cloud, "run").mockResolvedValue(SUCCESS);
  });

  it("asks the server to notify the next signer by default", async () => {
    await signWith(undefined);

    expect(runSpy).toHaveBeenCalledWith(
      "signPdf",
      expect.objectContaining({
        docId: "doc1",
        userId: "contact1",
        sendNextMail: true
      })
    );
  });

  it("forwards sendNextMail false to suppress the next signer email", async () => {
    await signWith(false);

    expect(runSpy).toHaveBeenCalledWith(
      "signPdf",
      expect.objectContaining({ sendNextMail: false })
    );
  });

  it("returns the server response unchanged", async () => {
    const result = await signWith(true);

    expect(result).toEqual(SUCCESS);
  });
});
