import { describe, it, expect } from "vitest";
import {
  OTP_INPUT_PATTERN,
  OTP_LENGTH,
  OTP_INVALID_ERROR_CODE,
  EMAIL_NOT_VERIFIED_ERROR_CODE,
  OTP_RESEND_LIMIT_ERROR_CODE,
  isEmailNotVerifiedError,
  isOtpFormatValid,
  isOtpInvalidError,
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

describe("isOtpFormatValid", () => {
  it("accepts exactly six digits", () => {
    expect(isOtpFormatValid("123456")).toBe(true);
    expect(isOtpFormatValid("000000")).toBe(true);
  });

  it("rejects wrong length, non digits and non strings", () => {
    expect(isOtpFormatValid("12345")).toBe(false);
    expect(isOtpFormatValid("1234567")).toBe(false);
    expect(isOtpFormatValid("12345a")).toBe(false);
    expect(isOtpFormatValid("")).toBe(false);
    expect(isOtpFormatValid(123456)).toBe(false);
    expect(isOtpFormatValid(undefined)).toBe(false);
  });
});

describe("server error code helpers", () => {
  it("maps the contract codes", () => {
    expect(OTP_INVALID_ERROR_CODE).toBe(142);
    expect(EMAIL_NOT_VERIFIED_ERROR_CODE).toBe(205);
  });

  it("detects invalid otp errors", () => {
    expect(isOtpInvalidError({ code: 142 })).toBe(true);
    expect(isOtpInvalidError({ code: 101 })).toBe(false);
    expect(isOtpInvalidError(undefined)).toBe(false);
  });

  it("detects email not verified errors", () => {
    expect(isEmailNotVerifiedError({ code: 205 })).toBe(true);
    expect(isEmailNotVerifiedError({ code: 202 })).toBe(false);
    expect(isEmailNotVerifiedError(null)).toBe(false);
  });
});
