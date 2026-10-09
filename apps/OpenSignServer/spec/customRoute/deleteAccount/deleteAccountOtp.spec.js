import {
  hashOtp,
  verifyAndConsumeOtp,
  OtpStatus,
} from '../../../cloud/parsefunction/shared/otpPolicy.js';
import {
  accountExists,
  createDeletableAdmin,
  elapseCooldown,
  findDeleteOtpRow,
  reloadExtUser,
  requestDeleteOtp,
  requestOtpAndReadCode,
  submitDeletion,
  updateDeleteOtpRow,
  useCommsMailCapture,
} from '../../utils/delete-account-fixtures.js';
import {
  createOtpRecord,
  rejectSaveFor,
  resetAuthState,
  silenceConsole,
  TEST_OTP,
} from '../../utils/auth-fixtures.js';

const MASTER = { useMasterKey: true };
const WRONG_CODE = '000001';
const MAX_FAILED_ATTEMPTS = 5;

const failTimes = async (userId, times) => {
  for (let attempt = 0; attempt < times; attempt += 1) {
    await submitDeletion(userId, WRONG_CODE);
  }
};

describe('delete account OTP issuance', () => {
  const mail = useCommsMailCapture();

  beforeEach(async () => {
    silenceConsole();
    spyOn(console, 'error');
    await resetAuthState();
  });

  it('emails a six digit code that never starts with zero even if Math.random is predictable', async () => {
    spyOn(Math, 'random').and.returnValue(0);
    const admin = await createDeletableAdmin();

    const { response, code } = await requestOtpAndReadCode(admin, mail);

    expect(response.status).toBe(200);
    expect(code).toMatch(/^[1-9]\d{5}$/);
  });

  it('addresses the code to the registered email of the account', async () => {
    const admin = await createDeletableAdmin();

    await requestDeleteOtp(admin.account.id);

    expect(mail.last().to).toBe(admin.account.email.toLowerCase());
  });

  it('answers with the cooldown and expiry the page relies on', async () => {
    const admin = await createDeletableAdmin();

    const response = await requestDeleteOtp(admin.account.id);

    expect(response.data).toEqual({ ok: true, cooldownSec: 30, expiresInMin: 10 });
  });

  it('stores only a keyed hash of the code and no plaintext on the user row', async () => {
    const admin = await createDeletableAdmin();

    const { code } = await requestOtpAndReadCode(admin, mail);

    const row = await findDeleteOtpRow(admin.account.email);
    const extUser = await reloadExtUser(admin.extUser);
    expect(row.get('OtpHash')).toBe(hashOtp(code));
    expect(JSON.stringify(row.toJSON())).not.toContain(code);
    expect(JSON.stringify(extUser.toJSON())).not.toContain(code);
    expect(extUser.get('DeleteOTP')).toBeUndefined();
  });

  it('does not make the code valid for the login or signup flow of the same email', async () => {
    const admin = await createDeletableAdmin();

    const { code } = await requestOtpAndReadCode(admin, mail);

    const status = await verifyAndConsumeOtp({ email: admin.account.email, otp: code });
    expect(status).toBe(OtpStatus.NOT_FOUND);
  });

  it('keeps an existing login OTP of the same email untouched', async () => {
    const admin = await createDeletableAdmin();
    await createOtpRecord(admin.account.email.toLowerCase());

    await requestDeleteOtp(admin.account.id);

    const status = await verifyAndConsumeOtp({ email: admin.account.email, otp: TEST_OTP });
    expect(status).toBe(OtpStatus.VALID);
  });

  it('rejects a second request while the cooldown is running', async () => {
    const admin = await createDeletableAdmin();
    await requestDeleteOtp(admin.account.id);

    const response = await requestDeleteOtp(admin.account.id);

    expect(response.status).toBe(429);
    expect(response.data.error).toBe('Cooldown not finished');
    expect(response.data.retryAfterSec).toBeGreaterThan(0);
    expect(mail.sent.length).toBe(1);
  });

  it('caps the number of codes per window even if the cooldown is skipped', async () => {
    const admin = await createDeletableAdmin();
    const statuses = [];

    for (let request = 0; request < 5; request += 1) {
      await elapseCooldown(await reloadExtUser(admin.extUser));
      statuses.push((await requestDeleteOtp(admin.account.id)).status);
    }

    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    expect(mail.sent.length).toBe(3);
  });

  it('reports a failure and not success when the mail cannot be delivered', async () => {
    const admin = await createDeletableAdmin();
    mail.providerStatus = 502;

    const response = await requestDeleteOtp(admin.account.id);

    expect(response.status).toBe(500);
    expect(response.data).toEqual({ error: 'Failed to send OTP' });
  });

  it('does not start the cooldown when the mail could not be delivered', async () => {
    const admin = await createDeletableAdmin();
    mail.providerStatus = 502;
    await requestDeleteOtp(admin.account.id);
    mail.providerStatus = 201;

    const response = await requestDeleteOtp(admin.account.id);

    expect(response.status).toBe(200);
  });

  it('reports a failure when the code cannot be persisted', async () => {
    const admin = await createDeletableAdmin();
    rejectSaveFor('defaultdata_Otp');

    const response = await requestDeleteOtp(admin.account.id);

    expect(response.status).toBe(500);
    expect(mail.sent.length).toBe(0);
  });

  it('answers 404 for an account that does not exist', async () => {
    const response = await requestDeleteOtp('missingUser1');

    expect(response.status).toBe(404);
    expect(response.data).toEqual({ error: 'User not found' });
  });

  it('refuses to issue a code for an account without a registered email', async () => {
    const admin = await createDeletableAdmin();
    admin.extUser.unset('Email');
    await admin.extUser.save(null, MASTER);

    const response = await requestDeleteOtp(admin.account.id);

    expect(response.status).toBe(400);
    expect(response.data).toEqual({ error: 'No registered email' });
    expect(mail.sent.length).toBe(0);
  });
});

describe('delete account OTP verification', () => {
  const mail = useCommsMailCapture();

  beforeEach(async () => {
    silenceConsole();
    spyOn(console, 'error');
    await resetAuthState();
  });

  it('deletes the account when the emailed code is submitted', async () => {
    const admin = await createDeletableAdmin();
    const { code } = await requestOtpAndReadCode(admin, mail);

    const response = await submitDeletion(admin.account.id, code);

    expect(response.status).toBe(200);
    expect(response.data).toBe('User and all associated data deleted successfully.');
    expect(await accountExists(admin.account.id)).toBeFalse();
  });

  it('consumes the code so it cannot be replayed', async () => {
    const admin = await createDeletableAdmin();
    const { code } = await requestOtpAndReadCode(admin, mail);
    await submitDeletion(admin.account.id, code);

    const row = await findDeleteOtpRow(admin.account.email);

    expect(row.get('OtpHash')).toBeUndefined();
    expect(row.get('ExpiresAt').getTime()).toBe(0);
  });

  it('rejects a wrong code and keeps the account', async () => {
    const admin = await createDeletableAdmin();
    await requestOtpAndReadCode(admin, mail);

    const response = await submitDeletion(admin.account.id, WRONG_CODE);

    expect(response.status).toBe(400);
    expect(response.data).toBe('Invalid OTP.');
    expect(await accountExists(admin.account.id)).toBeTrue();
  });

  it('locks the account after too many wrong codes even for the right one', async () => {
    const admin = await createDeletableAdmin();
    const { code } = await requestOtpAndReadCode(admin, mail);
    await failTimes(admin.account.id, MAX_FAILED_ATTEMPTS);

    const response = await submitDeletion(admin.account.id, code);

    expect(response.status).toBe(429);
    expect(await accountExists(admin.account.id)).toBeTrue();
  });

  it('does not release the lock by asking for a fresh code', async () => {
    const admin = await createDeletableAdmin();
    await requestOtpAndReadCode(admin, mail);
    await failTimes(admin.account.id, MAX_FAILED_ATTEMPTS);
    await elapseCooldown(await reloadExtUser(admin.extUser));
    const { code } = await requestOtpAndReadCode(admin, mail);

    const response = await submitDeletion(admin.account.id, code);

    expect(response.status).toBe(429);
    expect(await accountExists(admin.account.id)).toBeTrue();
  });

  it('rejects an expired code', async () => {
    const admin = await createDeletableAdmin();
    const { code } = await requestOtpAndReadCode(admin, mail);
    await updateDeleteOtpRow(admin.account.email, { ExpiresAt: new Date(Date.now() - 1000) });

    const response = await submitDeletion(admin.account.id, code);

    expect(response.status).toBe(400);
    expect(response.data).toBe('OTP has expired. Please request a new OTP.');
  });

  it('asks for a new code when none was ever issued', async () => {
    const admin = await createDeletableAdmin();

    const response = await submitDeletion(admin.account.id, TEST_OTP);

    expect(response.status).toBe(400);
    expect(response.data).toBe('No OTP found. Please request a new OTP.');
  });

  it('does not accept the login OTP of the same email as deletion proof', async () => {
    const admin = await createDeletableAdmin();
    await createOtpRecord(admin.account.email.toLowerCase());

    const response = await submitDeletion(admin.account.id, TEST_OTP);

    expect(response.status).toBe(400);
    expect(await accountExists(admin.account.id)).toBeTrue();
  });

  [
    ['is missing', undefined],
    ['is a number', 123456],
    ['is an object', { $ne: '' }],
    ['is empty', ''],
  ].forEach(([description, otp]) => {
    it(`requires a string code when the code ${description}`, async () => {
      const admin = await createDeletableAdmin();
      await requestOtpAndReadCode(admin, mail);

      const response = await submitDeletion(admin.account.id, otp);

      expect(response.status).toBe(400);
      expect(response.data).toBe('OTP is required.');
      expect(await accountExists(admin.account.id)).toBeTrue();
    });
  });

  it('does not count an absent code as a failed attempt', async () => {
    const admin = await createDeletableAdmin();
    const { code } = await requestOtpAndReadCode(admin, mail);
    for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS + 1; attempt += 1) {
      await submitDeletion(admin.account.id, undefined);
    }

    const response = await submitDeletion(admin.account.id, code);

    expect(response.status).toBe(200);
  });
});
