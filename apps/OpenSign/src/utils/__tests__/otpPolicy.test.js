import { describe, it, expect } from "vitest";
import {
  OTP_INPUT_PATTERN,
  OTP_LENGTH,
  OTP_RESEND_LIMIT_ERROR_CODE,
  isOtpResendLimitError
} from "../otpPolicy";

describe("otpPolicy constants", () => {
  it("expects a six digit code", () => {
    expect(OTP_LENGTH).toBe(6);
  });

  it("builds an input pattern that accepts exactly six digits", () => {
    const pattern = new RegExp(`^${OTP_INPUT_PATTERN}$`);

    expect(OTP_INPUT_PATTERN).toBe("[0-9]{6}");
    expect(pattern.test("123456")).toBe(true);
    expect(pattern.test("1234")).toBe(false);
    expect(pattern.test("1234567")).toBe(false);
    expect(pattern.test("12345a")).toBe(false);
  });

  it("uses the Parse REQUEST_LIMIT_EXCEEDED code for the resend limit", () => {
    expect(OTP_RESEND_LIMIT_ERROR_CODE).toBe(155);
  });
});

describe("isOtpResendLimitError", () => {
  it("detects a Parse error carrying the limit code", () => {
    expect(isOtpResendLimitError({ code: 155 })).toBe(true);
  });

  it("detects an axios error whose response body carries the limit code", () => {
    expect(isOtpResendLimitError({ response: { data: { code: 155 } } })).toBe(
      true
    );
  });

  it("ignores other error codes", () => {
    expect(isOtpResendLimitError({ code: 141 })).toBe(false);
    expect(isOtpResendLimitError({ response: { data: { code: 1 } } })).toBe(
      false
    );
  });

  it("ignores errors without a code and nullish values", () => {
    expect(isOtpResendLimitError(new Error("boom"))).toBe(false);
    expect(isOtpResendLimitError({ response: {} })).toBe(false);
    expect(isOtpResendLimitError(undefined)).toBe(false);
    expect(isOtpResendLimitError(null)).toBe(false);
  });
});
