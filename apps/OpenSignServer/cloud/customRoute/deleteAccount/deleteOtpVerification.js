import { OtpStatus, verifyAndConsumeOtp } from '../../parsefunction/shared/otpPolicy.js';
import { DELETE_ACCOUNT_PURPOSE } from './deleteUtils.js';

const REFUSALS = Object.freeze({
  [OtpStatus.LOCKED]: {
    status: 429,
    message: 'Too many invalid attempts. Please try again later.',
  },
  [OtpStatus.NOT_FOUND]: { status: 400, message: 'No OTP found. Please request a new OTP.' },
  [OtpStatus.EXPIRED]: { status: 400, message: 'OTP has expired. Please request a new OTP.' },
  [OtpStatus.INVALID]: { status: 400, message: 'Invalid OTP.' },
});

const MISSING_OTP_REFUSAL = Object.freeze({ status: 400, message: 'OTP is required.' });

export const checkDeleteOtp = async (email, otp) => {
  if (typeof otp !== 'string' || otp.length === 0) return MISSING_OTP_REFUSAL;
  const status = await verifyAndConsumeOtp({ email, otp, purpose: DELETE_ACCOUNT_PURPOSE });
  return REFUSALS[status] ?? null;
};
