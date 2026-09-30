import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VerifyEmail from "../VerifyEmail";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key) => key })
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
