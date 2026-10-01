import {
  PASSWORD,
  TEST_OTP,
  captureRejection,
  createOtpRecord,
  createPlainUser,
  findOtpRecord,
  findUserByUsername,
  isSessionValid,
  openPasswordSession,
  resetAuthState,
  silenceConsole,
  uniqueEmail,
} from '../utils/auth-fixtures.js';
import { isStrictAuthPath } from '../../utils/authRateLimiter.js';

const GENERIC_MESSAGE = 'Invalid credentials or OTP.';
const WRONG_OTP = '111111';
const WRONG_PASSWORD = 'Wrong-Passw0rd!';

const verifyLogin = params => Parse.Cloud.run('verifyloginotp', params);

const expectGenericFailure = error => {
  expect(error.code).toBe(Parse.Error.OBJECT_NOT_FOUND);
  expect(error.message).toBe(GENERIC_MESSAGE);
};

const createAccountWithOtp = async otpFields => {
  const account = await createPlainUser();
  await createOtpRecord(account.email, otpFields);
  return account;
};

describe('verifyloginotp cloud function', () => {
  let account;

  beforeEach(async () => {
    silenceConsole();
    await resetAuthState();
    account = await createAccountWithOtp();
  });

  afterEach(async () => {
    await resetAuthState();
  });

  it('creates a session, marks the email verified and keeps the password', async () => {
    const result = await verifyLogin({ email: account.email, password: PASSWORD, otp: TEST_OTP });

    const user = await findUserByUsername(account.email);
    expect(result.objectId).toBe(account.id);
    expect(await isSessionValid(result.sessionToken)).toBeTrue();
    expect(user.get('emailVerified')).toBeTrue();
    expect(typeof (await openPasswordSession(account.email))).toBe('string');
  });

  it('rejects a wrong password with the generic error and leaves the otp untouched', async () => {
    const error = await captureRejection(
      verifyLogin({ email: account.email, password: WRONG_PASSWORD, otp: TEST_OTP })
    );

    const otpRecord = await findOtpRecord(account.email);
    expectGenericFailure(error);
    expect((await findUserByUsername(account.email)).get('emailVerified')).not.toBeTrue();
    expect(otpRecord.get('FailedAttempts')).toBe(0);
    expect(otpRecord.get('OtpHash')).toBeDefined();
  });

  it('rejects an unknown email with the same generic error', async () => {
    const error = await captureRejection(
      verifyLogin({ email: uniqueEmail('ghost'), password: PASSWORD, otp: TEST_OTP })
    );

    expectGenericFailure(error);
  });

  it('rejects a wrong otp with the same generic error and counts the attempt', async () => {
    const error = await captureRejection(
      verifyLogin({ email: account.email, password: PASSWORD, otp: WRONG_OTP })
    );

    expectGenericFailure(error);
    expect((await findOtpRecord(account.email)).get('FailedAttempts')).toBe(1);
    expect((await findUserByUsername(account.email)).get('emailVerified')).not.toBeTrue();
  });

  it('rejects a reused otp', async () => {
    await verifyLogin({ email: account.email, password: PASSWORD, otp: TEST_OTP });

    const replay = await captureRejection(
      verifyLogin({ email: account.email, password: PASSWORD, otp: TEST_OTP })
    );

    expectGenericFailure(replay);
  });

  it('rejects an expired otp with the generic error', async () => {
    const expired = await createAccountWithOtp({ ExpiresAt: new Date(Date.now() - 1000) });

    const error = await captureRejection(
      verifyLogin({ email: expired.email, password: PASSWORD, otp: TEST_OTP })
    );

    expectGenericFailure(error);
  });

  it('reports the lock only after the password was proven', async () => {
    const locked = await createAccountWithOtp({ FailedAttempts: 5 });

    const rightPassword = await captureRejection(
      verifyLogin({ email: locked.email, password: PASSWORD, otp: TEST_OTP })
    );
    const wrongPassword = await captureRejection(
      verifyLogin({ email: locked.email, password: WRONG_PASSWORD, otp: TEST_OTP })
    );

    expect(rightPassword.code).toBe(Parse.Error.REQUEST_LIMIT_EXCEEDED);
    expect(rightPassword.message).toBe('Too many OTP attempts. Please try again later.');
    expectGenericFailure(wrongPassword);
  });

  it('rejects missing or malformed parameters with the generic error', async () => {
    const attempts = [
      {},
      { email: account.email },
      { email: account.email, password: PASSWORD },
      { email: account.email, password: PASSWORD, otp: { $ne: '' } },
      { email: { $ne: '' }, password: PASSWORD, otp: TEST_OTP },
      { email: account.email, password: { $ne: '' }, otp: TEST_OTP },
    ];

    for (const params of attempts) {
      expectGenericFailure(await captureRejection(verifyLogin(params)));
    }
    expect((await findOtpRecord(account.email)).get('FailedAttempts')).toBe(0);
  });

  it('lets the account use the plain password login afterwards', async () => {
    const blocked = await captureRejection(
      Parse.Cloud.run('loginuser', { email: account.email, password: PASSWORD })
    );
    await verifyLogin({ email: account.email, password: PASSWORD, otp: TEST_OTP });

    const result = await Parse.Cloud.run('loginuser', { email: account.email, password: PASSWORD });

    expect(blocked.code).toBe(Parse.Error.EMAIL_NOT_FOUND);
    expect(result.objectId).toBe(account.id);
  });

  it('rejects without consuming the otp when the typed email resolves to an account with another email', async () => {
    const mailbox = uniqueEmail('legacy-mailbox');
    const legacyUsername = uniqueEmail('legacy-username');
    const legacy = new Parse.User();
    legacy.set('username', legacyUsername);
    legacy.set('email', mailbox);
    legacy.set('password', PASSWORD);
    await legacy.save(null, { useMasterKey: true });
    await createOtpRecord(legacyUsername);

    const error = await captureRejection(
      verifyLogin({ email: legacyUsername, password: PASSWORD, otp: TEST_OTP })
    );

    const otpRecord = await findOtpRecord(legacyUsername);
    expectGenericFailure(error);
    expect(otpRecord.get('FailedAttempts')).toBe(0);
    expect(otpRecord.get('OtpHash')).toBeDefined();
    expect((await findUserByUsername(legacyUsername)).get('emailVerified')).not.toBeTrue();
  });

  it('is covered by the strict auth rate limiter', () => {
    expect(isStrictAuthPath('/parse/functions/verifyloginotp')).toBeTrue();
  });
});
