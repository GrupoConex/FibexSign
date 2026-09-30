import { describe, it, expect } from "vitest";
import {
  validateRequired,
  validateProvided,
  validateEmail,
  getPasswordRuleStatus,
  validateLoginForm,
  validateForgotPasswordForm,
  validateAddAdminForm,
  hasErrors,
  applyFieldError,
  getFirstInvalidFieldId
} from "../authFormValidation";

const validAdmin = {
  name: "Ada",
  email: "ada@example.com",
  phone: "+58 412",
  company: "Fibex",
  jobTitle: "CTO",
  password: "Abcdef1!",
  isAuthorize: true
};

describe("validateRequired", () => {
  it.each([[""], ["   "], [null], [undefined]])(
    "returns input-required for %j",
    (value) => {
      expect(validateRequired(value)).toBe("input-required");
    }
  );

  it("returns null for a non blank value", () => {
    expect(validateRequired(" a ")).toBeNull();
  });
});

describe("validateEmail", () => {
  it("returns input-required when empty or whitespace", () => {
    expect(validateEmail("")).toBe("input-required");
    expect(validateEmail("  ")).toBe("input-required");
    expect(validateEmail(undefined)).toBe("input-required");
  });

  it("returns valid-email-alert when the format is wrong", () => {
    expect(validateEmail("plain")).toBe("valid-email-alert");
    expect(validateEmail("a@b")).toBe("valid-email-alert");
    expect(validateEmail("a@b.c")).toBe("valid-email-alert");
  });

  it("accepts valid and uppercase emails", () => {
    expect(validateEmail("a@b.co")).toBeNull();
    expect(validateEmail("USER@EXAMPLE.COM")).toBeNull();
  });
});

describe("getPasswordRuleStatus", () => {
  it("flags every rule as failing for an empty password", () => {
    expect(getPasswordRuleStatus("")).toEqual({
      lengthValid: false,
      caseDigitValid: false,
      specialCharValid: false
    });
  });

  it("fails only length when short but otherwise compliant", () => {
    expect(getPasswordRuleStatus("Ab1!")).toEqual({
      lengthValid: false,
      caseDigitValid: true,
      specialCharValid: true
    });
  });

  it("fails only case/digit rule", () => {
    expect(getPasswordRuleStatus("abcdefgh!")).toEqual({
      lengthValid: true,
      caseDigitValid: false,
      specialCharValid: true
    });
    expect(getPasswordRuleStatus("ABCdefgh!").caseDigitValid).toBe(false);
  });

  it("fails only special char rule", () => {
    expect(getPasswordRuleStatus("Abcdefg1")).toEqual({
      lengthValid: true,
      caseDigitValid: true,
      specialCharValid: false
    });
  });

  it("passes all rules for a strong password", () => {
    expect(getPasswordRuleStatus("Abcdef1!")).toEqual({
      lengthValid: true,
      caseDigitValid: true,
      specialCharValid: true
    });
  });

  it("handles missing input", () => {
    expect(getPasswordRuleStatus(undefined).lengthValid).toBe(false);
  });
});

describe("validateLoginForm", () => {
  it("reports both fields when empty", () => {
    expect(validateLoginForm({ email: "", password: "" })).toEqual({
      email: "input-required",
      password: "input-required"
    });
  });

  it("reports only the failing field", () => {
    expect(validateLoginForm({ email: "bad", password: "x" })).toEqual({
      email: "valid-email-alert"
    });
  });

  it("returns an empty object when valid", () => {
    expect(validateLoginForm({ email: "a@b.co", password: "x" })).toEqual({});
  });
});

describe("validateForgotPasswordForm", () => {
  it("validates the email", () => {
    expect(validateForgotPasswordForm({ email: "" })).toEqual({
      email: "input-required"
    });
    expect(validateForgotPasswordForm({ email: "bad" })).toEqual({
      email: "valid-email-alert"
    });
    expect(validateForgotPasswordForm({ email: "a@b.co" })).toEqual({});
  });
});

describe("validateAddAdminForm", () => {
  it("returns an empty object when everything is valid", () => {
    expect(validateAddAdminForm(validAdmin)).toEqual({});
  });

  it("flags every empty field and terms", () => {
    expect(
      validateAddAdminForm({
        name: "",
        email: "",
        phone: "",
        company: "",
        jobTitle: "",
        password: "",
        isAuthorize: false
      })
    ).toEqual({
      name: "input-required",
      email: "input-required",
      phone: "input-required",
      company: "input-required",
      jobTitle: "input-required",
      password: "input-required",
      isAuthorize: "accept-terms-required"
    });
  });

  it("treats whitespace-only text as required", () => {
    expect(validateAddAdminForm({ ...validAdmin, name: "   " })).toEqual({
      name: "input-required"
    });
  });

  it("flags a weak password with the requirements key", () => {
    expect(validateAddAdminForm({ ...validAdmin, password: "abc" })).toEqual({
      password: "password-requirements-not-met"
    });
  });

  it("flags an invalid email format", () => {
    expect(validateAddAdminForm({ ...validAdmin, email: "a@b" })).toEqual({
      email: "valid-email-alert"
    });
  });

  it("does not mutate its input", () => {
    const input = Object.freeze({ ...validAdmin });
    expect(() => validateAddAdminForm(input)).not.toThrow();
  });
});

describe("hasErrors", () => {
  it("detects presence of errors", () => {
    expect(hasErrors({})).toBe(false);
    expect(hasErrors(undefined)).toBe(false);
    expect(hasErrors({ email: "input-required" })).toBe(true);
  });
});

describe("applyFieldError", () => {
  it("sets the error for the field without touching others", () => {
    const current = Object.freeze({ password: "input-required" });
    const next = applyFieldError(current, "email", {
      email: "valid-email-alert"
    });
    expect(next).toEqual({
      password: "input-required",
      email: "valid-email-alert"
    });
    expect(next).not.toBe(current);
  });

  it("removes the error when the field is now valid", () => {
    expect(
      applyFieldError(
        { email: "input-required", name: "input-required" },
        "email",
        {}
      )
    ).toEqual({ name: "input-required" });
  });

  it("handles missing current errors", () => {
    expect(applyFieldError(undefined, "email", {})).toEqual({});
  });
});

describe("getFirstInvalidFieldId", () => {
  const fieldIds = { name: "name", password: "admin-password", email: "email" };

  it("returns the id of the first invalid field in declared order", () => {
    expect(
      getFirstInvalidFieldId({ email: "x", password: "y" }, fieldIds)
    ).toBe("admin-password");
  });

  it("returns null when there are no errors", () => {
    expect(getFirstInvalidFieldId({}, fieldIds)).toBeNull();
    expect(getFirstInvalidFieldId(undefined, fieldIds)).toBeNull();
  });
});

describe("password is never trimmed", () => {
  it("validateProvided only rejects empty values", () => {
    expect(validateProvided("")).toBe("input-required");
    expect(validateProvided(null)).toBe("input-required");
    expect(validateProvided(undefined)).toBe("input-required");
    expect(validateProvided("   ")).toBeNull();
  });

  it("treats a whitespace-only login password as provided", () => {
    expect(validateLoginForm({ email: "a@b.co", password: "   " })).toEqual({});
  });

  it("reports unmet rules instead of required for a whitespace-only admin password", () => {
    expect(
      validateAddAdminForm({ ...validAdmin, password: "        " })
    ).toEqual({
      password: "password-requirements-not-met"
    });
  });
});
