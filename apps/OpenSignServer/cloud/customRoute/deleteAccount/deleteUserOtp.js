import { issueOtp, normalizeEmail } from '../../parsefunction/shared/otpPolicy.js';
import { findOwnExtUser } from './accountLookup.js';
import {
  DELETE_ACCOUNT_PURPOSE,
  OTP_EXPIRES_MIN,
  RESEND_COOLDOWN_SEC,
  isMailDelivered,
  msUntil,
  sendDeleteOtpEmail,
} from './deleteUtils.js';

const MASTER = { useMasterKey: true };
const LEGACY_OTP_FIELDS = ['DeleteOTP', 'DeleteOTPExpiry', 'DeleteOTPTries'];

const cooldownRemainingMs = (extUser, nowMs) => {
  const lastSentAt = extUser.get('DeleteOTPSentAt')?.getTime() ?? 0;
  return msUntil(nowMs, lastSentAt + RESEND_COOLDOWN_SEC * 1000);
};

const recordSend = async (extUser, nowMs) => {
  LEGACY_OTP_FIELDS.forEach(field => extUser.unset(field));
  extUser.set('DeleteOTPSentAt', new Date(nowMs));
  await extUser.save(null, MASTER);
};

const issueAndDeliver = async (extUser, email) => {
  const issued = await issueOtp({ email, purpose: DELETE_ACCOUNT_PURPOSE });
  if (!issued.allowed) {
    return { status: 429, body: { error: 'Too many OTP requests. Please try again later.' } };
  }
  if (!isMailDelivered(await sendDeleteOtpEmail(extUser, issued.otp))) {
    return { status: 500, body: { error: 'Failed to send OTP' } };
  }
  return null;
};

export const deleteUserOtp = async (req, res) => {
  const extUser = await findOwnExtUser(req.params.userId);
  if (!extUser) return res.status(404).json({ error: 'User not found' });

  const email = normalizeEmail(extUser.get('Email'));
  if (!email) return res.status(400).json({ error: 'No registered email' });

  const nowMs = Date.now();
  const remainingMs = cooldownRemainingMs(extUser, nowMs);
  if (remainingMs > 0) {
    return res
      .status(429)
      .json({ error: 'Cooldown not finished', retryAfterSec: Math.ceil(remainingMs / 1000) });
  }

  try {
    const refusal = await issueAndDeliver(extUser, email);
    if (refusal) return res.status(refusal.status).json(refusal.body);
    await recordSend(extUser, nowMs);
    return res.json({ ok: true, cooldownSec: RESEND_COOLDOWN_SEC, expiresInMin: OTP_EXPIRES_MIN });
  } catch (err) {
    console.error('Error sending delete OTP (POST /otp):', err);
    return res.status(500).json({ error: 'Failed to send OTP' });
  }
};
