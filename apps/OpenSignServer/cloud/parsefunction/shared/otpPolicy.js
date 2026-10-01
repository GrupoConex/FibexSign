import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_FAILED_ATTEMPTS = 5;
export const OTP_RESEND_LIMIT = 3;
export const OTP_RESEND_WINDOW_MS = 15 * 60 * 1000;

export const OtpStatus = Object.freeze({
  VALID: 'valid',
  INVALID: 'invalid',
  EXPIRED: 'expired',
  LOCKED: 'locked',
  NOT_FOUND: 'not_found',
});

const OTP_CLASS_NAME = 'defaultdata_Otp';
const MASTER = { useMasterKey: true };
const OTP_PATTERN = new RegExp(`^\\d{${OTP_LENGTH}}$`);
const OTP_LOWER_BOUND = 10 ** (OTP_LENGTH - 1);
const OTP_UPPER_BOUND = 10 ** OTP_LENGTH;

export const normalizeEmail = email =>
  typeof email === 'string' ? email.trim().toLowerCase() : '';

export const generateOtp = () => randomInt(OTP_LOWER_BOUND, OTP_UPPER_BOUND);

export const hashOtp = otp =>
  createHmac('sha256', process.env.MASTER_KEY).update(String(otp)).digest('hex');

const normalizeOtpInput = otp => {
  const candidate = String(otp ?? '').trim();
  return OTP_PATTERN.test(candidate) ? candidate : null;
};

export const isOtpMatch = (storedHash, otp) => {
  const candidate = normalizeOtpInput(otp);
  if (!candidate || typeof storedHash !== 'string') {
    return false;
  }
  const expected = Buffer.from(storedHash);
  const actual = Buffer.from(hashOtp(candidate));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

async function findOtpRow(email) {
  if (!email) {
    return undefined;
  }
  const query = new Parse.Query(OTP_CLASS_NAME);
  query.equalTo('Email', email);
  query.ascending('createdAt');
  query.addAscending('objectId');
  return query.first(MASTER);
}

const isExpired = (row, now) => {
  const expiresAt = row.get('ExpiresAt');
  return !(expiresAt instanceof Date) || expiresAt.getTime() < now;
};

const isSendWindowActive = (row, now) => {
  const windowStart = row.get('SendWindowStart');
  return windowStart instanceof Date && now - windowStart.getTime() < OTP_RESEND_WINDOW_MS;
};

async function createOtpRow(email, tenantId, now) {
  const row = new (Parse.Object.extend(OTP_CLASS_NAME))();
  row.set('Email', email);
  if (tenantId) {
    row.set('TenantId', tenantId);
  }
  row.set('SendWindowStart', new Date(now));
  row.set('SendCount', 0);
  row.set('FailedAttempts', 0);
  row.set('WindowEpoch', 0);
  row.set('ConsumeCount', 0);
  try {
    await row.save(null, MASTER);
  } catch (error) {
    if (error?.code !== Parse.Error.DUPLICATE_VALUE) {
      throw error;
    }
  }
  return findOtpRow(email);
}

async function findOrCreateOtpRow(email, tenantId, now) {
  return (await findOtpRow(email)) ?? createOtpRow(email, tenantId, now);
}

async function rollSendWindowIfExpired(row, now) {
  if (isSendWindowActive(row, now)) {
    return;
  }
  const observedEpoch = row.get('WindowEpoch') || 0;
  const observedSendCount = row.get('SendCount') || 0;
  const observedFailedAttempts = row.get('FailedAttempts') || 0;
  row.increment('WindowEpoch');
  await row.save(null, MASTER);
  if (row.get('WindowEpoch') !== observedEpoch + 1) {
    return;
  }
  row.increment('SendCount', -observedSendCount);
  row.increment('FailedAttempts', -observedFailedAttempts);
  row.set('SendWindowStart', new Date(now));
  await row.save(null, MASTER);
}

async function claimSend(row) {
  row.increment('SendCount');
  await row.save(null, MASTER);
  return row.get('SendCount');
}

export async function issueOtp({ email, tenantId }, now = Date.now()) {
  const row = await findOrCreateOtpRow(normalizeEmail(email), tenantId, now);
  await rollSendWindowIfExpired(row, now);
  if ((await claimSend(row)) > OTP_RESEND_LIMIT) {
    return { allowed: false };
  }
  const otp = generateOtp();
  row.set('OtpHash', hashOtp(otp));
  row.unset('OTP');
  row.set('ExpiresAt', new Date(now + OTP_TTL_MS));
  row.set('ConsumeCount', 0);
  await row.save(null, MASTER);
  return { allowed: true, otp };
}

async function claimAttempt(row) {
  row.increment('FailedAttempts');
  await row.save(null, MASTER);
  return row.get('FailedAttempts');
}

async function consumeRow(row) {
  row.unset('OtpHash');
  row.set('ExpiresAt', new Date(0));
  row.set('FailedAttempts', 0);
  row.increment('ConsumeCount');
  await row.save(null, MASTER);
  return row.get('ConsumeCount') === 1 ? OtpStatus.VALID : OtpStatus.INVALID;
}

export async function verifyAndConsumeOtp({ email, otp }, now = Date.now()) {
  const row = await findOtpRow(normalizeEmail(email));
  if (!row) {
    return OtpStatus.NOT_FOUND;
  }
  if ((row.get('FailedAttempts') || 0) >= OTP_MAX_FAILED_ATTEMPTS) {
    return OtpStatus.LOCKED;
  }
  if (isExpired(row, now)) {
    return OtpStatus.EXPIRED;
  }
  const attempts = await claimAttempt(row);
  if (attempts > OTP_MAX_FAILED_ATTEMPTS) {
    return OtpStatus.LOCKED;
  }
  if (!isOtpMatch(row.get('OtpHash'), otp)) {
    return attempts >= OTP_MAX_FAILED_ATTEMPTS ? OtpStatus.LOCKED : OtpStatus.INVALID;
  }
  return consumeRow(row);
}
