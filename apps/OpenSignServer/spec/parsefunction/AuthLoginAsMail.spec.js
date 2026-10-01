import axios from 'axios';
import {
  TEST_OTP,
  createOtpRecord,
  createPlainUser,
  findOtpRecord,
  rejectFirstFor,
  resetAuthState,
  silenceConsole,
  uniqueEmail,
} from '../utils/auth-fixtures.js';

const OTP_VALUE = TEST_OTP;
const WRONG_OTP = '111111';
const LOCKOUT_THRESHOLD = 5;
const MASTER = { useMasterKey: true };
const INVALID_OTP = 'Invalid Otp';

const loginWith = params => Parse.Cloud.run('AuthLoginAsMail', params);

const readAttempts = async email => (await findOtpRecord(email)).get('FailedAttempts');

const readUser = userId => new Parse.Query(Parse.User).get(userId, MASTER);

const createOtpUser = async (prefix, otpFields = {}) => {
  const account = await createPlainUser(uniqueEmail(prefix));
  await createOtpRecord(account.email, { otp: OTP_VALUE, ...otpFields });
  return account;
};

describe('AuthLoginAsMail cloud function', () => {
  let originalAdapter;
  let consoleLog;

  beforeEach(async () => {
    consoleLog = silenceConsole();
    await resetAuthState();
    originalAdapter = axios.defaults.adapter;
  });

  afterEach(async () => {
    axios.defaults.adapter = originalAdapter;
    await resetAuthState();
  });

  it('answers user not found when no otp was issued for the email', async () => {
    const result = await loginWith({ email: uniqueEmail('otp-none'), otp: OTP_VALUE });

    expect(result).toBe('user not found!');
  });

  it('answers user not found when the email is missing', async () => {
    const result = await loginWith({ otp: OTP_VALUE });

    expect(result).toBe('user not found!');
  });

  it('returns the session of the user and marks the email verified on a correct otp', async () => {
    const account = await createOtpUser('otp-success');

    const result = await loginWith({ email: account.email, otp: OTP_VALUE });

    expect(result.objectId).toBe(account.id);
    expect(typeof result.sessionToken).toBe('string');
    expect((await readUser(account.id)).get('emailVerified')).toBeTrue();
  });

  it('accepts the otp when it is sent as a number', async () => {
    const account = await createOtpUser('otp-number');

    const result = await loginWith({ email: account.email, otp: Number(OTP_VALUE) });

    expect(result.objectId).toBe(account.id);
  });

  it('accepts the otp regardless of email casing and surrounding whitespace', async () => {
    const account = await createOtpUser('otp-casing');

    const result = await loginWith({ email: ` ${account.email.toUpperCase()} `, otp: OTP_VALUE });

    expect(result.objectId).toBe(account.id);
  });

  it('refuses a record without expiry even when the otp is correct', async () => {
    const account = await createOtpUser('otp-bare', { ExpiresAt: undefined });

    const result = await loginWith({ email: account.email, otp: OTP_VALUE });

    expect(result).toBe(INVALID_OTP);
  });

  it('refuses a legacy record that only has a plaintext otp', async () => {
    const account = await createOtpUser('otp-legacy', { OtpHash: undefined, OTP: 4242 });

    const result = await loginWith({ email: account.email, otp: 4242 });

    expect(result).toBe(INVALID_OTP);
  });

  it('returns the session directly when the email was already verified', async () => {
    const account = await createOtpUser('otp-verified');
    const user = await readUser(account.id);
    user.set('emailVerified', true);
    await user.save(null, MASTER);

    const result = await loginWith({ email: account.email, otp: OTP_VALUE });

    expect(result.objectId).toBe(account.id);
    expect(result.emailVerified).toBeTrue();
  });

  it('rejects a wrong otp and counts the failed attempt', async () => {
    const account = await createOtpUser('otp-wrong');

    const result = await loginWith({ email: account.email, otp: WRONG_OTP });

    expect(result).toBe(INVALID_OTP);
    expect(await readAttempts(account.email)).toBe(1);
  });

  it('counts a missing otp as a failed attempt', async () => {
    const account = await createOtpUser('otp-missing');

    const result = await loginWith({ email: account.email });

    expect(result).toBe(INVALID_OTP);
    expect(await readAttempts(account.email)).toBe(1);
  });

  it('refuses the correct otp once the attempt threshold is reached and stops counting', async () => {
    const account = await createOtpUser('otp-locked', { FailedAttempts: LOCKOUT_THRESHOLD });

    const result = await loginWith({ email: account.email, otp: OTP_VALUE });

    expect(result).toBe(INVALID_OTP);
    expect(await readAttempts(account.email)).toBe(LOCKOUT_THRESHOLD);
  });

  it('refuses a wrong otp without counting when the record is locked', async () => {
    const account = await createOtpUser('otp-locked-wrong', { FailedAttempts: LOCKOUT_THRESHOLD });

    const result = await loginWith({ email: account.email, otp: WRONG_OTP });

    expect(result).toBe(INVALID_OTP);
    expect(await readAttempts(account.email)).toBe(LOCKOUT_THRESHOLD);
  });

  it('refuses an expired otp without counting a failed attempt', async () => {
    const account = await createOtpUser('otp-expired', {
      ExpiresAt: new Date(Date.now() - 60 * 1000),
    });

    const result = await loginWith({ email: account.email, otp: OTP_VALUE });

    expect(result).toBe(INVALID_OTP);
    expect(await readAttempts(account.email)).toBe(0);
  });

  it('allows the last attempt just below the threshold', async () => {
    const account = await createOtpUser('otp-last-try', { FailedAttempts: LOCKOUT_THRESHOLD - 1 });

    const result = await loginWith({ email: account.email, otp: OTP_VALUE });

    expect(result.objectId).toBe(account.id);
  });

  it('answers Result not found when no account matches the email of a valid otp', async () => {
    const email = uniqueEmail('otp-no-account');
    await createOtpRecord(email, { otp: OTP_VALUE });

    const result = await loginWith({ email, otp: OTP_VALUE });

    expect(result).toBe('Result not found');
  });

  it('answers Result not found when the loginAs request fails', async () => {
    const account = await createOtpUser('otp-net-fail');
    const adapter = jasmine.createSpy('adapter').and.rejectWith(new Error('network down'));
    axios.defaults.adapter = adapter;

    const result = await loginWith({ email: account.email, otp: OTP_VALUE });

    expect(result).toBe('Result not found');
    expect(adapter).toHaveBeenCalledTimes(1);
    expect((await readUser(account.id)).get('emailVerified')).toBeFalsy();
  });

  it('answers Result not found when the loginAs response has no body', async () => {
    const account = await createOtpUser('otp-empty-body');
    const adapter = jasmine
      .createSpy('adapter')
      .and.callFake(config =>
        Promise.resolve({ data: '', status: 200, statusText: 'OK', headers: {}, config })
      );
    axios.defaults.adapter = adapter;

    const result = await loginWith({ email: account.email, otp: OTP_VALUE });

    expect(result).toBe('Result not found');
    expect(adapter).toHaveBeenCalledTimes(1);
    expect((await readUser(account.id)).get('emailVerified')).toBeFalsy();
  });

  it('answers Result not found when the otp lookup fails', async () => {
    const lookup = rejectFirstFor('defaultdata_Otp', new Error('otp lookup failed'));

    const result = await loginWith({ email: uniqueEmail('otp-lookup'), otp: OTP_VALUE });

    expect(result).toBe('Result not found');
    expect(lookup.hits()).toBe(1);
  });

  describe('defensive branches (unreachable via public API)', () => {
    it('reports a controlled not found reason instead of a ReferenceError when saving the verified user yields nothing', async () => {
      const account = await createOtpUser('otp-empty-save');
      const userSave = spyOn(Parse.User.prototype, 'save').and.resolveTo(undefined);

      const result = await loginWith({ email: account.email, otp: OTP_VALUE });

      const loggedValues = consoleLog.calls.allArgs().flat();
      const loggedErrors = loggedValues.filter(value => value instanceof Error);
      expect(userSave.calls.count()).toBe(1);
      expect(result).toBe('Result not found');
      expect(loggedValues.some(value => value instanceof ReferenceError)).toBeFalse();
      expect(loggedErrors.map(error => error.message)).toEqual(['user not found!']);
      expect(loggedErrors[0] instanceof Parse.Error).toBeTrue();
    });
  });

  describe('one-time use', () => {
    it('does not let a used otp mint another session', async () => {
      const account = await createOtpUser('otp-replay');
      await loginWith({ email: account.email, otp: OTP_VALUE });

      const replay = await loginWith({ email: account.email, otp: OTP_VALUE });

      expect(replay).toBe(INVALID_OTP);
    });

    it('invalidates the otp record after a successful login', async () => {
      const account = await createOtpUser('otp-consumed');

      await loginWith({ email: account.email, otp: OTP_VALUE });

      expect((await findOtpRecord(account.email)).get('OtpHash')).toBeUndefined();
    });

    it('invalidates the otp record even when the email was already verified', async () => {
      const account = await createOtpUser('otp-consumed-verified');
      const user = await readUser(account.id);
      user.set('emailVerified', true);
      await user.save(null, MASTER);

      await loginWith({ email: account.email, otp: OTP_VALUE });

      expect((await findOtpRecord(account.email)).get('OtpHash')).toBeUndefined();
    });

    it('keeps the record after a wrong otp so the real one still works', async () => {
      const account = await createOtpUser('otp-kept');
      await loginWith({ email: account.email, otp: WRONG_OTP });

      const result = await loginWith({ email: account.email, otp: OTP_VALUE });

      expect(result.objectId).toBe(account.id);
    });

    it('consumes the otp even when the session request fails afterwards', async () => {
      const account = await createOtpUser('otp-consumed-failure');
      axios.defaults.adapter = jasmine
        .createSpy('adapter')
        .and.rejectWith(new Error('network down'));

      const failed = await loginWith({ email: account.email, otp: OTP_VALUE });
      const retry = await loginWith({ email: account.email, otp: OTP_VALUE });

      expect(failed).toBe('Result not found');
      expect(retry).toBe(INVALID_OTP);
    });

    it('lets only one of two simultaneous logins with the same otp succeed', async () => {
      const account = await createOtpUser('otp-simultaneous');

      const results = await Promise.all([
        loginWith({ email: account.email, otp: OTP_VALUE }),
        loginWith({ email: account.email, otp: OTP_VALUE }),
      ]);

      const sessions = results.filter(result => typeof result === 'object');
      expect(sessions.length).toBe(1);
    });
  });
});
