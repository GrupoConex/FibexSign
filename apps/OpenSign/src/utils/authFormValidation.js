import { emailRegex } from "../constant/const";

const REQUIRED_KEY = "input-required";
const INVALID_EMAIL_KEY = "valid-email-alert";
const PASSWORD_RULES_KEY = "password-requirements-not-met";
const TERMS_KEY = "accept-terms-required";
const MIN_PASSWORD_LENGTH = 8;

const normalize = (value) =>
  typeof value === "string" ? value.trim() : (value ?? "");

export const validateRequired = (value) =>
  normalize(value) === "" ? REQUIRED_KEY : null;

export const validateProvided = (value) =>
  value === undefined || value === null || value === "" ? REQUIRED_KEY : null;

export const validateEmail = (value) => {
  const required = validateRequired(value);
  if (required) return required;
  return emailRegex.test(normalize(value)) ? null : INVALID_EMAIL_KEY;
};

export const getPasswordRuleStatus = (password) => {
  const value = password ?? "";
  return {
    lengthValid: value.length >= MIN_PASSWORD_LENGTH,
    caseDigitValid:
      /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value),
    specialCharValid: /[!@#$%^&*()\-_=+{};:,<.>]/.test(value)
  };
};

const validatePasswordRules = (password) => {
  const required = validateProvided(password);
  if (required) return required;
  const rules = getPasswordRuleStatus(password);
  return Object.values(rules).every(Boolean) ? null : PASSWORD_RULES_KEY;
};

const collectErrors = (checks) =>
  Object.fromEntries(Object.entries(checks).filter(([, key]) => key));

export const validateLoginForm = ({ email, password }) =>
  collectErrors({
    email: validateEmail(email),
    password: validateProvided(password)
  });

export const validateForgotPasswordForm = ({ email }) =>
  collectErrors({ email: validateEmail(email) });

export const validateAddAdminForm = ({
  name,
  email,
  phone,
  company,
  jobTitle,
  password,
  isAuthorize
}) =>
  collectErrors({
    name: validateRequired(name),
    email: validateEmail(email),
    phone: validateRequired(phone),
    company: validateRequired(company),
    jobTitle: validateRequired(jobTitle),
    password: validatePasswordRules(password),
    isAuthorize: isAuthorize ? null : TERMS_KEY
  });

export const hasErrors = (errors) => Object.keys(errors ?? {}).length > 0;

export const applyFieldError = (errors, field, validation) => {
  const { [field]: _previous, ...rest } = errors ?? {};
  return validation?.[field] ? { ...rest, [field]: validation[field] } : rest;
};

export const getFirstInvalidFieldId = (errors, fieldIds) => {
  const invalidField = Object.keys(fieldIds).find((field) => errors?.[field]);
  return invalidField ? fieldIds[invalidField] : null;
};
