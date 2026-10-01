export const OTP_LENGTH = 6;
export const OTP_INPUT_PATTERN = `[0-9]{${OTP_LENGTH}}`;
export const OTP_RESEND_LIMIT_ERROR_CODE = 155;
export const OTP_INVALID_ERROR_CODE = 142;
export const EMAIL_NOT_VERIFIED_ERROR_CODE = 205;

const OTP_FORMAT = new RegExp(`^${OTP_INPUT_PATTERN}$`);

export const isOtpFormatValid = (otp) =>
  typeof otp === "string" && OTP_FORMAT.test(otp);

export const isOtpInvalidError = (error) =>
  error?.code === OTP_INVALID_ERROR_CODE;

export const isEmailNotVerifiedError = (error) =>
  error?.code === EMAIL_NOT_VERIFIED_ERROR_CODE;

export const isOtpResendLimitError = (error) =>
  error?.code === OTP_RESEND_LIMIT_ERROR_CODE ||
  error?.response?.data?.code === OTP_RESEND_LIMIT_ERROR_CODE;
