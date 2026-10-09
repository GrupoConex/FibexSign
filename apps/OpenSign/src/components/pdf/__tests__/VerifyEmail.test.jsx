import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VerifyEmail from "../VerifyEmail";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({
    t: (key, options) =>
      options?.seconds === undefined ? key : `${key}:${options.seconds}`
  })
}));

const renderModal = (props = {}) =>
  render(
    <VerifyEmail
      isVerifyModal
      otp=""
      setOtp={vi.fn()}
      setIsVerifyModal={vi.fn()}
      handleVerifyEmail={vi.fn()}
      handleResend={vi.fn()}
      handleVerifyBtn={vi.fn()}
      isResendDisabled={false}
      isSending={false}
      resendSecondsLeft={0}
      {...props}
    />
  );

describe("VerifyEmail OTP input", () => {
  it("expects exactly six digits", () => {
    renderModal();

    const otpInput = screen.getByPlaceholderText("otp-placeholder");

    expect(otpInput).toHaveAttribute("pattern", "[0-9]{6}");
    expect(otpInput).toHaveAttribute("maxlength", "6");
    expect(otpInput).toHaveAttribute("inputmode", "numeric");
  });

  it("rejects a four digit code and accepts a six digit code", () => {
    const { rerender } = renderModal({ otp: "1234" });
    expect(screen.getByPlaceholderText("otp-placeholder").validity.valid).toBe(
      false
    );

    rerender(
      <VerifyEmail
        isVerifyModal
        otp="123456"
        setOtp={vi.fn()}
        setIsVerifyModal={vi.fn()}
        handleVerifyEmail={vi.fn()}
        handleResend={vi.fn()}
        handleVerifyBtn={vi.fn()}
      />
    );

    expect(screen.getByPlaceholderText("otp-placeholder").validity.valid).toBe(
      true
    );
  });

  it("reports what the user types", async () => {
    const setOtp = vi.fn();
    renderModal({ setOtp });

    await userEvent.type(screen.getByPlaceholderText("otp-placeholder"), "7");

    expect(setOtp).toHaveBeenCalledWith("7");
  });
});

describe("VerifyEmail resend button", () => {
  it("calls handleResend without submitting the form", async () => {
    const handleResend = vi.fn();
    const handleVerifyEmail = vi.fn();
    renderModal({ handleResend, handleVerifyEmail });

    await userEvent.click(
      screen.getByRole("button", { name: "resend", hidden: true })
    );

    expect(handleResend).toHaveBeenCalledTimes(1);
    expect(handleVerifyEmail).not.toHaveBeenCalled();
  });

  it("calls handleResend without the click event", async () => {
    const handleResend = vi.fn();
    renderModal({ handleResend });

    await userEvent.click(
      screen.getByRole("button", { name: "resend", hidden: true })
    );

    expect(handleResend).toHaveBeenCalledWith();
  });

  it("shows the loading label while a send is in flight", () => {
    renderModal({ isResendDisabled: true, isSending: true });

    expect(
      screen.getByRole("button", { name: "loading", hidden: true })
    ).toBeDisabled();
  });

  it("returns the focus to the code input after resending", async () => {
    renderModal({ handleResend: vi.fn().mockResolvedValue(true) });

    await userEvent.click(
      screen.getByRole("button", { name: "resend", hidden: true })
    );

    await waitFor(() =>
      expect(screen.getByPlaceholderText("otp-placeholder")).toHaveFocus()
    );
  });

  it("shows the countdown and disables resend during the cooldown", () => {
    renderModal({ isResendDisabled: true, resendSecondsLeft: 30 });

    expect(
      screen.getByRole("button", { name: "resend-in-seconds:30", hidden: true })
    ).toBeDisabled();
  });

  it("disables resend while a send is in flight", () => {
    renderModal({ isResendDisabled: true, resendSecondsLeft: 0 });

    expect(
      screen.getByRole("button", { name: "resend", hidden: true })
    ).toBeDisabled();
  });
});
