import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import GuestLogin from "../GuestLogin";

const cloudRun = vi.fn();
const notifyError = vi.fn();
const notifyWarning = vi.fn();

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({
    t: (key) => key,
    i18n: { language: "en", changeLanguage: () => Promise.resolve() }
  })
}));

vi.mock("parse", () => ({
  default: {
    Cloud: { run: (...args) => cloudRun(...args) },
    User: { become: vi.fn() }
  }
}));

vi.mock("../../utils", async (importOriginal) => ({
  ...(await importOriginal()),
  notify: {
    success: vi.fn(),
    error: (...args) => notifyError(...args),
    warning: (...args) => notifyWarning(...args),
    info: vi.fn(),
    dismiss: vi.fn()
  }
}));

vi.mock("../../constant/Utils", async (importOriginal) => ({
  ...(await importOriginal()),
  saveLanguageInLocal: vi.fn(),
  contractUsers: vi.fn().mockResolvedValue([])
}));

vi.mock("../../components/pdf/SelectLanguage", () => ({ default: () => null }));
vi.mock("../../hook/useIsDarkTheme", () => ({ useIsDarkTheme: () => false }));

const encodedLink = btoa("doc-1/guest@example.com/contact-1");

const renderGuestLogin = () =>
  render(
    <MemoryRouter initialEntries={[`/login/${encodedLink}`]}>
      <Routes>
        <Route path="/login/:base64url" element={<GuestLogin />} />
      </Routes>
    </MemoryRouter>
  );

const requestVerificationCode = async () => {
  const user = userEvent.setup();
  const button = await screen.findByRole("button", {
    name: "get-verification-code"
  });
  await user.click(button);
  return user;
};

describe("GuestLogin OTP request", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cloudRun.mockImplementation(async (name) => {
      if (name === "getDocument") return { error: "otp required" };
      return undefined;
    });
  });

  it("shows the resend limit message when the server answers with code 155", async () => {
    cloudRun.mockImplementation(async (name) => {
      if (name === "getDocument") return { error: "otp required" };
      throw { code: 155, message: "Too many OTP requests." };
    });
    renderGuestLogin();

    await requestVerificationCode();

    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith("otp-resend-limit")
    );
    expect(notifyError).not.toHaveBeenCalledWith("something-went-wrong-mssg");
  });

  it("keeps the generic message for any other failure", async () => {
    cloudRun.mockImplementation(async (name) => {
      if (name === "getDocument") return { error: "otp required" };
      throw { code: 1, message: "Could not send the OTP email." };
    });
    renderGuestLogin();

    await requestVerificationCode();

    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith("something-went-wrong-mssg")
    );
    expect(notifyError).not.toHaveBeenCalledWith("otp-resend-limit");
  });

  it("opens the OTP modal expecting exactly six digits after a successful request", async () => {
    cloudRun.mockImplementation(async (name) => {
      if (name === "getDocument") return { error: "otp required" };
      return "Otp send";
    });
    renderGuestLogin();

    await requestVerificationCode();

    const otpInput = await screen.findByPlaceholderText("otp-placeholder");
    expect(otpInput).toHaveAttribute("pattern", "[0-9]{6}");
    expect(otpInput).toHaveAttribute("maxlength", "6");
    expect(otpInput).toHaveAttribute("inputmode", "numeric");
  });
});
