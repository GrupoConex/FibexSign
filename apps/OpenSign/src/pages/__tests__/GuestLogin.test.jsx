import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import GuestLogin from "../GuestLogin";

const cloudRun = vi.fn();
const notifyError = vi.fn();
const notifyWarning = vi.fn();
const notifySuccess = vi.fn();

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({
    t: (key, options) =>
      options?.seconds === undefined ? key : `${key}:${options.seconds}`,
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
    success: (...args) => notifySuccess(...args),
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

describe("GuestLogin OTP resend feedback", () => {
  const sendOtpCalls = () =>
    cloudRun.mock.calls.filter(([name]) => name === "SendOTPMailV1");

  beforeEach(() => {
    vi.clearAllMocks();
    cloudRun.mockImplementation(async (name) => {
      if (name === "getDocument") return { error: "otp required" };
      return "Otp send";
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("confirms the sent code in a persistent polite status region without a toast", async () => {
    renderGuestLogin();

    await requestVerificationCode();

    const status = await screen.findByRole("status", { hidden: true });
    expect(status).toHaveAttribute("aria-live", "polite");
    await waitFor(() => expect(status).toHaveTextContent("otp-sent-to-email"));
    expect(notifySuccess).not.toHaveBeenCalled();
  });

  it("keeps the status region in the accessibility tree when it is empty", async () => {
    renderGuestLogin();
    cloudRun.mockImplementation(async (name) => {
      if (name === "getDocument") return { error: "otp required" };
      return "Otp send";
    });

    await requestVerificationCode();

    const status = await screen.findByRole("status", { hidden: true });
    expect(status).toHaveClass("empty:sr-only");
    expect(status).not.toHaveClass("empty:hidden");
  });

  it("empties the notice while resending and then announces the resent text", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderGuestLogin();
    const user = await requestVerificationCode();
    await screen.findByRole("button", {
      name: "resend-in-seconds:60",
      hidden: true
    });
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    let finishResend;
    cloudRun.mockImplementation(async (name) => {
      if (name === "getDocument") return { error: "otp required" };
      return new Promise((resolve) => {
        finishResend = resolve;
      });
    });

    await user.click(
      await screen.findByRole("button", { name: "resend", hidden: true })
    );

    await waitFor(() =>
      expect(screen.getByRole("status", { hidden: true })).toBeEmptyDOMElement()
    );
    await act(async () => {
      finishResend("Otp send");
    });
    expect(screen.getByRole("status", { hidden: true })).toHaveTextContent(
      "otp-resent-to-email"
    );
  });

  it("shows the countdown and the sent notice when reopening the modal during the cooldown", async () => {
    renderGuestLogin();
    const user = await requestVerificationCode();
    await screen.findByPlaceholderText("otp-placeholder");
    await user.click(screen.getByRole("button", { name: "✕", hidden: true }));
    expect(screen.queryByPlaceholderText("otp-placeholder")).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "get-verification-code" })
    );

    expect(
      await screen.findByPlaceholderText("otp-placeholder")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "resend-in-seconds:60",
        hidden: true
      })
    ).toBeDisabled();
    expect(screen.getByRole("status", { hidden: true })).toHaveTextContent(
      "otp-sent-to-email"
    );
    expect(sendOtpCalls()).toHaveLength(1);
  });

  it("focuses the code input when the modal shows after a send", async () => {
    renderGuestLogin();

    await requestVerificationCode();

    expect(await screen.findByPlaceholderText("otp-placeholder")).toHaveFocus();
  });

  it("disables resend and shows the countdown after a successful send", async () => {
    renderGuestLogin();

    await requestVerificationCode();

    const resend = await screen.findByRole("button", {
      name: "resend-in-seconds:60",
      hidden: true
    });
    expect(resend).toBeDisabled();
  });

  it("enables resend again once the cooldown ends and confirms the new send", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderGuestLogin();
    const user = await requestVerificationCode();
    await screen.findByRole("button", {
      name: "resend-in-seconds:60",
      hidden: true
    });

    act(() => {
      vi.advanceTimersByTime(60000);
    });
    notifySuccess.mockClear();
    await user.click(
      await screen.findByRole("button", { name: "resend", hidden: true })
    );

    await waitFor(() => expect(sendOtpCalls()).toHaveLength(2));
    expect(notifySuccess).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("button", {
        name: "resend-in-seconds:60",
        hidden: true
      })
    ).toBeDisabled();
  });

  it("sends a single code on a double click of the request button", async () => {
    renderGuestLogin();
    const user = userEvent.setup();
    const button = await screen.findByRole("button", {
      name: "get-verification-code"
    });

    await user.dblClick(button);

    await screen.findByPlaceholderText("otp-placeholder");
    expect(sendOtpCalls()).toHaveLength(1);
  });

  it("does not start a cooldown nor confirm when the send fails", async () => {
    cloudRun.mockImplementation(async (name) => {
      if (name === "getDocument") return { error: "otp required" };
      throw { code: 155, message: "Too many OTP requests." };
    });
    renderGuestLogin();

    await requestVerificationCode();

    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith("otp-resend-limit")
    );
    expect(notifySuccess).not.toHaveBeenCalled();
    expect(screen.queryByText(/resend-in-seconds/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "get-verification-code" })
    ).toBeEnabled();
  });
});
