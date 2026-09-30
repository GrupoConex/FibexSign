import axios from 'axios';
import { knownDefect } from '../utils/known-defect.js';
import {
  createOtpRecord,
  createPlainUser,
  findOtpRecord,
  rejectFirstFor,
  resetAuthState,
  silenceConsole,
  uniqueEmail,
} from '../utils/auth-fixtures.js';

const OTP_VALUE = 4242;
const WRONG_OTP = 1111;
const LOCKOUT_THRESHOLD = 5;
const MASTER = { useMasterKey: true };
const INVALID_OTP = 'Invalid Otp';

const loginWith = params => Parse.Cloud.run('AuthLoginAsMail', params);

const readAttempts = async email => (await findOtpRecord(email)).get('FailedAttempts');

const readUser = userId => new Parse.Query(Parse.User).get(userId, MASTER);

const createOtpUser = async (prefix, otpFields = {}) => {
  const account = await createPlainUser(uniqueEmail(prefix));
  await createOtpRecord(account.email, { OTP: OTP_VALUE, ...otpFields });
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

  it('accepts the otp when it is sent as a numeric string', async () => {
    const account = await createOtpUser('otp-string');

    const result = await loginWith({ email: account.email, otp: String(OTP_VALUE) });

    expect(result.objectId).toBe(account.id);
  });

  it('accepts a correct otp on a record without expiry or attempt counters', async () => {
    const account = await createPlainUser(uniqueEmail('otp-bare'));
    const record = new Parse.Object('defaultdata_Otp');
    record.set('Email', account.email);
    record.set('OTP', OTP_VALUE);
    await record.save(null, MASTER);

    const result = await loginWith({ email: account.email, otp: OTP_VALUE });

    expect(result.objectId).toBe(account.id);
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
    await createOtpRecord(email, { OTP: OTP_VALUE });

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
    it(
      'reports a not found reason instead of a ReferenceError when saving the verified user yields nothing',
      knownDefect(
        'DEF-01',
        'AuthLoginAsMail calls an undeclared reject(), so the empty save branch throws a ReferenceError that is swallowed as Result not found',
        async check => {
          const account = await createOtpUser('otp-empty-save');
          const userSave = spyOn(Parse.User.prototype, 'save').and.resolveTo(undefined);

          const result = await loginWith({ email: account.email, otp: OTP_VALUE });

          const loggedValues = consoleLog.calls.allArgs().flat();
          check(userSave.calls.count() === 1, 'the verified user save must be attempted');
          check(result === 'Result not found', 'the caller must get the generic failure');
          check(
            !loggedValues.some(value => value instanceof ReferenceError),
            'no ReferenceError may be logged for the empty save branch'
          );
        }
      )
    );
  });

  it(
    'does not let a used otp mint another session',
    knownDefect(
      'SEC-01',
      'AuthLoginAsMail never consumes or expires the otp after a successful login, so it can be replayed until ExpiresAt',
      async check => {
        const account = await createOtpUser('otp-replay');
        await loginWith({ email: account.email, otp: OTP_VALUE });

        const replay = await loginWith({ email: account.email, otp: OTP_VALUE });

        check(replay === INVALID_OTP, 'a used otp must be rejected');
      }
    )
  );
});
