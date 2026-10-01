import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { handleSendOTP } from "../Utils";

const notifyError = vi.fn();

vi.mock("axios", () => ({ default: { post: vi.fn() } }));

vi.mock("../../i18n", () => ({
  default: { t: (key) => key, language: "en" }
}));

vi.mock("../../utils", async (importOriginal) => ({
  ...(await importOriginal()),
  notify: {
    success: vi.fn(),
    error: (...args) => notifyError(...args),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn()
  }
}));

describe("handleSendOTP", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("baseUrl", "https://server.test/");
    localStorage.setItem("parseAppId", "app-id");
  });

  it("posts the email to SendOTPMailV1 and reports success", async () => {
    axios.post.mockResolvedValue({ data: { result: "Otp send" } });

    const isSent = await handleSendOTP("user@example.com");

    expect(isSent).toBe(true);
    expect(axios.post).toHaveBeenCalledWith(
      "https://server.test/functions/SendOTPMailV1",
      { email: "user@example.com" },
      {
        headers: {
          "Content-Type": "application/json",
          "X-Parse-Application-Id": "app-id"
        }
      }
    );
    expect(notifyError).not.toHaveBeenCalled();
  });

  it("shows the resend limit message when the server answers with code 155", async () => {
    axios.post.mockRejectedValue({
      message: "Request failed with status code 400",
      response: {
        data: {
          code: 155,
          error: "Too many OTP requests. Please try again later."
        }
      }
    });

    const isSent = await handleSendOTP("user@example.com");

    expect(isSent).toBe(false);
    expect(notifyError).toHaveBeenCalledTimes(1);
    expect(notifyError).toHaveBeenCalledWith("otp-resend-limit");
  });

  it("shows the error message for any other failure", async () => {
    axios.post.mockRejectedValue({
      message: "Network Error",
      response: { data: { code: 1 } }
    });

    const isSent = await handleSendOTP("user@example.com");

    expect(isSent).toBe(false);
    expect(notifyError).toHaveBeenCalledWith("Network Error");
  });
});
