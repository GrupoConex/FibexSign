export const OTP_LENGTH = 6;
export const OTP_INPUT_PATTERN = `[0-9]{${OTP_LENGTH}}`;
export const OTP_RESEND_LIMIT_ERROR_CODE = 155;

export const isOtpResendLimitError = (error) =>
  error?.code === OTP_RESEND_LIMIT_ERROR_CODE ||
  error?.response?.data?.code === OTP_RESEND_LIMIT_ERROR_CODE;
