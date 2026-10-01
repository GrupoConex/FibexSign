import nodeCrypto, { createHmac } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { MongoClient } from 'mongodb';
import {
  EMAIL_UNIQUE_INDEX,
  OTP_COLLECTION,
  migrateOtpTable,
} from '../../../scripts/migrate-otp-table.js';
import {
  captureRejection,
  createOtpRecord,
  findOtpRecord,
  resetAuthState,
  silenceConsole,
  uniqueEmail,
} from '../../utils/auth-fixtures.js';
import {
  OTP_LENGTH,
  OTP_MAX_FAILED_ATTEMPTS,
  OTP_RESEND_LIMIT,
  OTP_RESEND_WINDOW_MS,
  OTP_TTL_MS,
  OtpStatus,
  generateOtp,
  hashOtp,
  isOtpMatch,
  issueOtp,
  normalizeEmail,
  verifyAndConsumeOtp,
} from '../../../cloud/parsefunction/shared/otpPolicy.js';

const GENERATED_SAMPLE_SIZE = 500;
const SIX_DIGIT_PATTERN = /^\d{6}$/;
const KNOWN_OTP = 123456;
const WRONG_OTP = 654321;
const MINUTE_MS = 60 * 1000;
const originalTimingSafeEqual = nodeCrypto.timingSafeEqual;
const TEST_DATABASE_URI = 'mongodb://localhost:27017/parse-test';

const withoutEmailUniqueIndex = async run => {
  const client = new MongoClient(TEST_DATABASE_URI);
  await client.connect();
  const collection = client.db().collection(OTP_COLLECTION);
  await collection.dropIndex(EMAIL_UNIQUE_INDEX);
  try {
    await run(collection);
  } finally {
    await collection.deleteMany({});
    await migrateOtpTable({ collection, apply: true });
    await client.close();
  }
};

const countRows = async email => {
  const query = new Parse.Query('defaultdata_Otp');
  query.equalTo('Email', email);
  return query.count({ useMasterKey: true });
};

const exhaustResendLimit = async (email, now) => {
  for (let sent = 0; sent < OTP_RESEND_LIMIT; sent += 1) {
    await issueOtp({ email }, now);
  }
};

describe('otpPolicy', () => {
  beforeEach(async () => {
    silenceConsole();
    await resetAuthState();
  });

  describe('policy constants', () => {
    it('defines the agreed limits', () => {
      expect(OTP_LENGTH).toBe(6);
      expect(OTP_TTL_MS).toBe(10 * MINUTE_MS);
      expect(OTP_MAX_FAILED_ATTEMPTS).toBe(5);
      expect(OTP_RESEND_LIMIT).toBe(3);
      expect(OTP_RESEND_WINDOW_MS).toBe(15 * MINUTE_MS);
    });
  });

  describe('generateOtp', () => {
    it('always produces a six digit number without a leading zero', () => {
      const samples = Array.from({ length: GENERATED_SAMPLE_SIZE }, generateOtp);

      samples.forEach(sample => {
        expect(Number.isInteger(sample)).toBeTrue();
        expect(String(sample)).toMatch(SIX_DIGIT_PATTERN);
      });
    });

    it('does not repeat the same value on every call', () => {
      const samples = new Set(Array.from({ length: GENERATED_SAMPLE_SIZE }, generateOtp));

      expect(samples.size).toBeGreaterThan(GENERATED_SAMPLE_SIZE / 2);
    });
  });

  describe('hashOtp', () => {
    it('is the HMAC-SHA256 of the otp keyed with the master key', () => {
      const expected = createHmac('sha256', process.env.MASTER_KEY).update('123456').digest('hex');

      expect(hashOtp(KNOWN_OTP)).toBe(expected);
      expect(hashOtp('123456')).toBe(expected);
    });

    it('never contains the plaintext otp and differs per otp', () => {
      expect(hashOtp(KNOWN_OTP)).not.toContain('123456');
      expect(hashOtp(KNOWN_OTP)).not.toBe(hashOtp(WRONG_OTP));
    });
  });

  describe('normalizeEmail', () => {
    it('trims and lowercases strings', () => {
      expect(normalizeEmail('  Mixed.Case@Example.COM ')).toBe('mixed.case@example.com');
    });

    [undefined, null, 42, {}, ['a@b.c']].forEach(value => {
      it(`returns an empty string for ${JSON.stringify(value)}`, () => {
        expect(normalizeEmail(value)).toBe('');
      });
    });
  });

  describe('isOtpMatch', () => {
    const storedHash = hashOtp(KNOWN_OTP);

    [KNOWN_OTP, String(KNOWN_OTP), ` ${KNOWN_OTP} `].forEach(input => {
      it(`accepts ${JSON.stringify(input)}`, () => {
        expect(isOtpMatch(storedHash, input)).toBeTrue();
      });
    });

    [WRONG_OTP, '12345', '1234567', '12345a', 'abcdef', '', undefined, null, {}].forEach(input => {
      it(`rejects ${JSON.stringify(input)}`, () => {
        expect(isOtpMatch(storedHash, input)).toBeFalse();
      });
    });

    it('rejects when the stored value is not a string', () => {
      expect(isOtpMatch(undefined, KNOWN_OTP)).toBeFalse();
      expect(isOtpMatch(KNOWN_OTP, KNOWN_OTP)).toBeFalse();
    });

    it('rejects a stored value of a different length', () => {
      expect(isOtpMatch('abcd', KNOWN_OTP)).toBeFalse();
    });
  });

  describe('issueOtp', () => {
    it('stores only the hash with expiry, counters and tenant', async () => {
      const email = uniqueEmail('issue-store');
      const now = Date.now();

      const issued = await issueOtp({ email, tenantId: 'tenant-1' }, now);

      const stored = await findOtpRecord(email);
      expect(issued.allowed).toBeTrue();
      expect(String(issued.otp)).toMatch(SIX_DIGIT_PATTERN);
      expect(stored.get('OtpHash')).toBe(hashOtp(issued.otp));
      expect(stored.get('OTP')).toBeUndefined();
      expect(stored.get('ExpiresAt').getTime()).toBe(now + OTP_TTL_MS);
      expect(stored.get('SendCount')).toBe(1);
      expect(stored.get('SendWindowStart').getTime()).toBe(now);
      expect(stored.get('FailedAttempts')).toBe(0);
      expect(stored.get('TenantId')).toBe('tenant-1');
    });

    it('leaves the tenant unset when none is provided', async () => {
      const email = uniqueEmail('issue-no-tenant');

      await issueOtp({ email });

      expect((await findOtpRecord(email)).get('TenantId')).toBeUndefined();
    });

    it('keys the record by the normalized email', async () => {
      const email = uniqueEmail('issue-normalize');

      await issueOtp({ email: `  ${email.toUpperCase()} ` });

      expect((await findOtpRecord(email)).get('Email')).toBe(email);
    });

    it('reuses the record and counts every send inside the window', async () => {
      const email = uniqueEmail('issue-reuse');
      const now = Date.now();

      await issueOtp({ email }, now);
      const second = await issueOtp({ email }, now + MINUTE_MS);

      const stored = await findOtpRecord(email);
      expect(await countRows(email)).toBe(1);
      expect(stored.get('SendCount')).toBe(2);
      expect(stored.get('SendWindowStart').getTime()).toBe(now);
      expect(stored.get('OtpHash')).toBe(hashOtp(second.otp));
    });

    it('refuses the send after the resend limit without changing the stored otp', async () => {
      const email = uniqueEmail('issue-limit');
      const now = Date.now();
      await exhaustResendLimit(email, now);
      const before = (await findOtpRecord(email)).get('OtpHash');

      const refused = await issueOtp({ email }, now + MINUTE_MS);

      const stored = await findOtpRecord(email);
      expect(refused).toEqual({ allowed: false });
      expect(stored.get('OtpHash')).toBe(before);
      expect(stored.get('SendCount')).toBeGreaterThanOrEqual(OTP_RESEND_LIMIT);
    });

    it('applies the resend limit case-insensitively', async () => {
      const email = uniqueEmail('issue-limit-case');
      const now = Date.now();
      await exhaustResendLimit(email, now);

      const refused = await issueOtp({ email: email.toUpperCase() }, now + MINUTE_MS);

      expect(refused.allowed).toBeFalse();
    });

    it('allows sending again once the window has elapsed and restarts the counters', async () => {
      const email = uniqueEmail('issue-window');
      const now = Date.now();
      await exhaustResendLimit(email, now);
      const later = now + OTP_RESEND_WINDOW_MS;

      const issued = await issueOtp({ email }, later);

      const stored = await findOtpRecord(email);
      expect(issued.allowed).toBeTrue();
      expect(stored.get('SendCount')).toBe(1);
      expect(stored.get('SendWindowStart').getTime()).toBe(later);
    });

    it('keeps the failed attempts when resending inside the window', async () => {
      const email = uniqueEmail('issue-keep-failures');
      await createOtpRecord(email, {
        FailedAttempts: 4,
        SendCount: 1,
        SendWindowStart: new Date(),
      });

      await issueOtp({ email });

      expect((await findOtpRecord(email)).get('FailedAttempts')).toBe(4);
    });

    it('counts the first send when an active window has no send counter yet', async () => {
      const email = uniqueEmail('issue-no-counter');
      const windowStart = new Date(Date.now() - MINUTE_MS);
      await createOtpRecord(email, { SendWindowStart: windowStart });

      await issueOtp({ email });

      const stored = await findOtpRecord(email);
      expect(stored.get('SendCount')).toBe(1);
      expect(stored.get('SendWindowStart').getTime()).toBe(windowStart.getTime());
    });

    it('does not unlock a locked record before its window expires', async () => {
      const email = uniqueEmail('issue-stay-locked');
      await createOtpRecord(email, {
        FailedAttempts: OTP_MAX_FAILED_ATTEMPTS,
        SendCount: 1,
        SendWindowStart: new Date(),
      });

      const issued = await issueOtp({ email });

      const status = await verifyAndConsumeOtp({ email, otp: issued.otp });
      expect(status).toBe(OtpStatus.LOCKED);
    });

    it('unlocks a locked record once its window has expired', async () => {
      const email = uniqueEmail('issue-unlock');
      const windowStart = new Date(Date.now() - OTP_RESEND_WINDOW_MS - MINUTE_MS);
      await createOtpRecord(email, {
        FailedAttempts: OTP_MAX_FAILED_ATTEMPTS,
        SendCount: OTP_RESEND_LIMIT,
        SendWindowStart: windowStart,
      });

      const issued = await issueOtp({ email });

      expect((await findOtpRecord(email)).get('FailedAttempts')).toBe(0);
      expect(await verifyAndConsumeOtp({ email, otp: issued.otp })).toBe(OtpStatus.VALID);
    });

    it('treats a legacy record without window data as a fresh window and drops the plaintext otp', async () => {
      const email = uniqueEmail('issue-legacy');
      const legacy = await createOtpRecord(email, { FailedAttempts: 3, OTP: 4242 });

      const issued = await issueOtp({ email });

      const stored = await findOtpRecord(email);
      expect(stored.id).toBe(legacy.id);
      expect(stored.get('OTP')).toBeUndefined();
      expect(stored.get('FailedAttempts')).toBe(0);
      expect(stored.get('SendCount')).toBe(1);
      expect(stored.get('OtpHash')).toBe(hashOtp(issued.otp));
    });

    it('rejects when the record cannot be saved', async () => {
      const email = uniqueEmail('issue-save-fail');
      const failure = new Parse.Error(141, 'save failed');
      spyOn(Parse.Object.prototype, 'save').and.rejectWith(failure);

      const error = await captureRejection(issueOtp({ email }));

      expect(error).toBe(failure);
    });
  });

  describe('verifyAndConsumeOtp', () => {
    it('answers not_found when no otp was issued', async () => {
      const status = await verifyAndConsumeOtp({
        email: uniqueEmail('verify-none'),
        otp: KNOWN_OTP,
      });

      expect(status).toBe(OtpStatus.NOT_FOUND);
    });

    [undefined, null, '', '   ', 42, {}].forEach(email => {
      it(`answers not_found without querying for email ${JSON.stringify(email)}`, async () => {
        const queryFirst = spyOn(Parse.Query.prototype, 'first').and.callThrough();

        const status = await verifyAndConsumeOtp({ email, otp: KNOWN_OTP });

        expect(status).toBe(OtpStatus.NOT_FOUND);
        expect(queryFirst).not.toHaveBeenCalled();
      });
    });

    it('accepts the correct otp once and invalidates the record', async () => {
      const email = uniqueEmail('verify-valid');
      const issued = await issueOtp({ email });

      const first = await verifyAndConsumeOtp({ email, otp: issued.otp });
      const replay = await verifyAndConsumeOtp({ email, otp: issued.otp });

      const stored = await findOtpRecord(email);
      expect(first).toBe(OtpStatus.VALID);
      expect(replay).toBe(OtpStatus.EXPIRED);
      expect(stored.get('OtpHash')).toBeUndefined();
      expect(stored.get('FailedAttempts')).toBe(0);
    });

    it('clears earlier failed attempts when the otp is consumed', async () => {
      const email = uniqueEmail('verify-clear-failures');
      await createOtpRecord(email, { otp: KNOWN_OTP, FailedAttempts: 3 });

      await verifyAndConsumeOtp({ email, otp: KNOWN_OTP });

      expect((await findOtpRecord(email)).get('FailedAttempts')).toBe(0);
    });

    it('accepts a freshly issued otp after an earlier one was consumed', async () => {
      const email = uniqueEmail('verify-reissue');
      const first = await issueOtp({ email });
      await verifyAndConsumeOtp({ email, otp: first.otp });
      const second = await issueOtp({ email });

      const status = await verifyAndConsumeOtp({ email, otp: second.otp });

      expect(status).toBe(OtpStatus.VALID);
    });

    it('accepts the otp regardless of email casing and whitespace', async () => {
      const email = uniqueEmail('verify-casing');
      const issued = await issueOtp({ email });

      const status = await verifyAndConsumeOtp({
        email: ` ${email.toUpperCase()} `,
        otp: `${issued.otp}`,
      });

      expect(status).toBe(OtpStatus.VALID);
    });

    it('answers invalid for a wrong otp and counts the attempt', async () => {
      const email = uniqueEmail('verify-wrong');
      await createOtpRecord(email, { otp: KNOWN_OTP });

      const status = await verifyAndConsumeOtp({ email, otp: WRONG_OTP });

      expect(status).toBe(OtpStatus.INVALID);
      expect((await findOtpRecord(email)).get('FailedAttempts')).toBe(1);
    });

    it('counts a malformed or missing otp as a failed attempt', async () => {
      const email = uniqueEmail('verify-malformed');
      await createOtpRecord(email, { otp: KNOWN_OTP });

      await verifyAndConsumeOtp({ email, otp: 'abc' });
      await verifyAndConsumeOtp({ email });

      expect((await findOtpRecord(email)).get('FailedAttempts')).toBe(2);
    });

    it('answers locked when the fifth wrong attempt is recorded and keeps the record', async () => {
      const email = uniqueEmail('verify-lock');
      await createOtpRecord(email, { otp: KNOWN_OTP });
      const statuses = [];

      for (let attempt = 0; attempt < OTP_MAX_FAILED_ATTEMPTS; attempt += 1) {
        statuses.push(await verifyAndConsumeOtp({ email, otp: WRONG_OTP }));
      }

      expect(statuses.slice(0, -1).every(status => status === OtpStatus.INVALID)).toBeTrue();
      expect(statuses.at(-1)).toBe(OtpStatus.LOCKED);
      expect((await findOtpRecord(email)).get('FailedAttempts')).toBe(OTP_MAX_FAILED_ATTEMPTS);
    });

    it('refuses the correct otp once locked and stops counting', async () => {
      const email = uniqueEmail('verify-locked');
      await createOtpRecord(email, { otp: KNOWN_OTP, FailedAttempts: OTP_MAX_FAILED_ATTEMPTS });

      const status = await verifyAndConsumeOtp({ email, otp: KNOWN_OTP });

      expect(status).toBe(OtpStatus.LOCKED);
      expect((await findOtpRecord(email)).get('FailedAttempts')).toBe(OTP_MAX_FAILED_ATTEMPTS);
    });

    it('accepts the correct otp on the last attempt below the threshold', async () => {
      const email = uniqueEmail('verify-last-try');
      await createOtpRecord(email, { otp: KNOWN_OTP, FailedAttempts: OTP_MAX_FAILED_ATTEMPTS - 1 });

      const status = await verifyAndConsumeOtp({ email, otp: KNOWN_OTP });

      expect(status).toBe(OtpStatus.VALID);
    });

    it('answers expired without counting an attempt', async () => {
      const email = uniqueEmail('verify-expired');
      await createOtpRecord(email, { otp: KNOWN_OTP, ExpiresAt: new Date(Date.now() - MINUTE_MS) });

      const status = await verifyAndConsumeOtp({ email, otp: KNOWN_OTP });

      expect(status).toBe(OtpStatus.EXPIRED);
      expect((await findOtpRecord(email)).get('FailedAttempts')).toBe(0);
    });

    it('accepts the otp exactly at its ttl boundary', async () => {
      const email = uniqueEmail('verify-ttl');
      const now = Date.now();
      const issued = await issueOtp({ email }, now);

      const status = await verifyAndConsumeOtp({ email, otp: issued.otp }, now + OTP_TTL_MS);

      expect(status).toBe(OtpStatus.VALID);
    });

    it('answers expired after the ttl has elapsed', async () => {
      const email = uniqueEmail('verify-ttl-elapsed');
      const now = Date.now();
      const issued = await issueOtp({ email }, now);

      const status = await verifyAndConsumeOtp({ email, otp: issued.otp }, now + OTP_TTL_MS + 1);

      expect(status).toBe(OtpStatus.EXPIRED);
    });

    it('treats a record without expiry as expired', async () => {
      const email = uniqueEmail('verify-no-expiry');
      await createOtpRecord(email, { otp: KNOWN_OTP, ExpiresAt: undefined });

      const status = await verifyAndConsumeOtp({ email, otp: KNOWN_OTP });

      expect(status).toBe(OtpStatus.EXPIRED);
    });

    it('never accepts a legacy record that has no hash', async () => {
      const email = uniqueEmail('verify-legacy');
      await createOtpRecord(email, { OtpHash: undefined, OTP: 424242 });

      const status = await verifyAndConsumeOtp({ email, otp: 424242 });

      expect(status).toBe(OtpStatus.INVALID);
    });

    it('answers invalid when another request consumed the otp at the same time', async () => {
      const email = uniqueEmail('verify-race');
      const issued = await issueOtp({ email });
      const originalSave = Parse.Object.prototype.save;
      spyOn(Parse.Object.prototype, 'save').and.callFake(async function (...args) {
        if (!this.get('OtpHash')) {
          const rival = new Parse.Object(this.className);
          rival.id = this.id;
          rival.increment('ConsumeCount');
          await originalSave.call(rival, null, { useMasterKey: true });
        }
        return originalSave.apply(this, args);
      });

      const status = await verifyAndConsumeOtp({ email, otp: issued.otp });

      expect(status).toBe(OtpStatus.INVALID);
    });

    it('rethrows a failure while consuming the otp', async () => {
      const email = uniqueEmail('verify-consume-fail');
      await createOtpRecord(email, { otp: KNOWN_OTP });
      const failure = new Parse.Error(141, 'consume failed');
      const originalSave = Parse.Object.prototype.save;
      spyOn(Parse.Object.prototype, 'save').and.callFake(function (...args) {
        return this.get('OtpHash') ? originalSave.apply(this, args) : Promise.reject(failure);
      });

      const error = await captureRejection(verifyAndConsumeOtp({ email, otp: KNOWN_OTP }));

      expect(error).toBe(failure);
    });

    it('rethrows a failure while recording a wrong attempt', async () => {
      const email = uniqueEmail('verify-save-fail');
      await createOtpRecord(email, { otp: KNOWN_OTP });
      const failure = new Parse.Error(141, 'save failed');
      spyOn(Parse.Object.prototype, 'save').and.rejectWith(failure);

      const error = await captureRejection(verifyAndConsumeOtp({ email, otp: WRONG_OTP }));

      expect(error).toBe(failure);
    });
  });

  describe('claim-first limits under parallel requests', () => {
    const PARALLEL_REQUESTS = 20;

    const countHashComparisons = async run => {
      const comparisons = spyOn(nodeCrypto, 'timingSafeEqual').and.callThrough();
      syncBuiltinESMExports();
      try {
        const outcome = await run();
        return { comparisons: comparisons.calls.count(), outcome };
      } finally {
        comparisons.and.stub();
        nodeCrypto.timingSafeEqual = originalTimingSafeEqual;
        syncBuiltinESMExports();
      }
    };

    const fireInParallel = (count, task) => Promise.all(Array.from({ length: count }, task));

    it('evaluates at most five guesses however many arrive in parallel', async () => {
      const email = uniqueEmail('parallel-wrong');
      await createOtpRecord(email, { otp: KNOWN_OTP });

      const { comparisons, outcome } = await countHashComparisons(() =>
        fireInParallel(PARALLEL_REQUESTS, () => verifyAndConsumeOtp({ email, otp: WRONG_OTP }))
      );

      const invalidCount = outcome.filter(status => status === OtpStatus.INVALID).length;
      const lockedCount = outcome.filter(status => status === OtpStatus.LOCKED).length;
      expect(comparisons).toBe(OTP_MAX_FAILED_ATTEMPTS);
      expect(invalidCount).toBe(OTP_MAX_FAILED_ATTEMPTS - 1);
      expect(lockedCount).toBe(PARALLEL_REQUESTS - (OTP_MAX_FAILED_ATTEMPTS - 1));
    });

    it('evaluates at most one more guess when one attempt is left', async () => {
      const email = uniqueEmail('parallel-last-attempt');
      await createOtpRecord(email, { otp: KNOWN_OTP, FailedAttempts: OTP_MAX_FAILED_ATTEMPTS - 1 });

      const { comparisons, outcome } = await countHashComparisons(() =>
        fireInParallel(PARALLEL_REQUESTS, index =>
          verifyAndConsumeOtp({ email, otp: index === 0 ? KNOWN_OTP : WRONG_OTP })
        )
      );

      expect(comparisons).toBe(1);
      expect(outcome.filter(status => status === OtpStatus.VALID).length).toBeLessThanOrEqual(1);
    });

    it('lets the correct guess win when it claims an attempt within the limit', async () => {
      const email = uniqueEmail('parallel-correct');
      const issued = await issueOtp({ email });

      const outcome = await fireInParallel(PARALLEL_REQUESTS, () =>
        verifyAndConsumeOtp({ email, otp: issued.otp })
      );

      expect(outcome.filter(status => status === OtpStatus.VALID).length).toBe(1);
    });

    it('allows at most three sends when many are requested in parallel for a new email', async () => {
      const email = uniqueEmail('parallel-send');

      const outcome = await fireInParallel(PARALLEL_REQUESTS, () => issueOtp({ email }));

      expect(outcome.filter(result => result.allowed).length).toBe(OTP_RESEND_LIMIT);
      expect(await countRows(email)).toBe(1);
    });

    it('allows at most three sends when many arrive exactly as the window expires', async () => {
      const email = uniqueEmail('parallel-window');
      const now = Date.now();
      await exhaustResendLimit(email, now);

      const outcome = await fireInParallel(PARALLEL_REQUESTS, () =>
        issueOtp({ email }, now + OTP_RESEND_WINDOW_MS)
      );

      expect(outcome.filter(result => result.allowed).length).toBeLessThanOrEqual(OTP_RESEND_LIMIT);
      expect(await countRows(email)).toBe(1);
    });

    it('keeps the failed attempts counted across the window rollover claim', async () => {
      const email = uniqueEmail('parallel-rollover');
      const windowStart = new Date(Date.now() - OTP_RESEND_WINDOW_MS - MINUTE_MS);
      await createOtpRecord(email, {
        FailedAttempts: 4,
        SendCount: 2,
        SendWindowStart: windowStart,
      });

      await fireInParallel(5, () => issueOtp({ email }));

      const stored = await findOtpRecord(email);
      expect(stored.get('FailedAttempts')).toBe(0);
      expect(stored.get('SendCount')).toBe(5);
    });

    it('reuses the existing record when a parallel request created it first', async () => {
      const email = uniqueEmail('duplicate-create');
      const existing = await issueOtp({ email });
      const originalFirst = Parse.Query.prototype.first;
      let hiddenOnce = false;
      spyOn(Parse.Query.prototype, 'first').and.callFake(function (...args) {
        if (this.className === 'defaultdata_Otp' && !hiddenOnce) {
          hiddenOnce = true;
          return Promise.resolve(undefined);
        }
        return originalFirst.apply(this, args);
      });

      const issued = await issueOtp({ email });

      expect(existing.allowed).toBeTrue();
      expect(issued.allowed).toBeTrue();
      expect(await countRows(email)).toBe(1);
      expect((await findOtpRecord(email)).get('SendCount')).toBe(2);
    });

    it('keeps the send cap even when the unique index is missing', async () => {
      await withoutEmailUniqueIndex(async () => {
        const email = uniqueEmail('no-index-send');

        const outcome = await fireInParallel(PARALLEL_REQUESTS, () => issueOtp({ email }));

        expect(outcome.filter(result => result.allowed).length).toBe(OTP_RESEND_LIMIT);
      });
    });

    it('keeps the attempt cap even when the unique index is missing', async () => {
      await withoutEmailUniqueIndex(async () => {
        const email = uniqueEmail('no-index-verify');
        await issueOtp({ email });

        const { comparisons } = await countHashComparisons(() =>
          fireInParallel(PARALLEL_REQUESTS, () => verifyAndConsumeOtp({ email, otp: WRONG_OTP }))
        );

        expect(comparisons).toBe(OTP_MAX_FAILED_ATTEMPTS);
      });
    });

    it('works on the oldest record after creating a duplicate without the unique index', async () => {
      await withoutEmailUniqueIndex(async collection => {
        const email = uniqueEmail('no-index-oldest');
        const oldest = await createOtpRecord(email, { SendCount: 0, SendWindowStart: new Date() });
        const originalFirst = Parse.Query.prototype.first;
        let hiddenOnce = false;
        spyOn(Parse.Query.prototype, 'first').and.callFake(function (...args) {
          if (this.className === 'defaultdata_Otp' && !hiddenOnce) {
            hiddenOnce = true;
            return Promise.resolve(undefined);
          }
          return originalFirst.apply(this, args);
        });

        const issued = await issueOtp({ email });

        const rows = await collection.find({ Email: email }).sort({ _created_at: 1 }).toArray();
        expect(issued.allowed).toBeTrue();
        expect(rows.length).toBe(2);
        expect(rows[0]._id).toBe(oldest.id);
        expect(rows[0].SendCount).toBe(1);
        expect(rows[1].SendCount).toBe(0);
        expect(await verifyAndConsumeOtp({ email, otp: issued.otp })).toBe(OtpStatus.VALID);
      });
    });

    it('rethrows a failure that is not a duplicate while creating the record', async () => {
      const failure = new Parse.Error(141, 'create failed');
      spyOn(Parse.Object.prototype, 'save').and.rejectWith(failure);

      const error = await captureRejection(issueOtp({ email: uniqueEmail('create-fail') }));

      expect(error).toBe(failure);
    });
  });
});
