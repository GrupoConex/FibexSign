import { OTP_MAX_FAILED_ATTEMPTS } from '../../cloud/parsefunction/shared/otpPolicy.js';
import {
  TEST_OTP,
  PASSWORD,
  createMasterKeySession,
  isSessionValid,
  openPasswordSessionBypassingGate,
  loginRejected,
  captureRejection,
  cloudRunAs,
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

const readEmailVerified = async userId => {
  const user = await new Parse.Query(Parse.User).get(userId, { useMasterKey: true });
  return user.get('emailVerified');
};

const markVerified = async userId => {
  const user = await new Parse.Query(Parse.User).get(userId, { useMasterKey: true });
  user.set('emailVerified', true);
  await user.save(null, { useMasterKey: true });
};

const verifyAs = (account, params) => cloudRunAs('verifyemail', params, account.sessionToken);

describe('verifyemail cloud function', () => {
  beforeEach(async () => {
    silenceConsole();
    await resetAuthState();
  });

  afterEach(async () => {
    await resetAuthState();
  });

  it('rejects unauthenticated callers with INVALID_SESSION_TOKEN', async () => {
    const error = await captureRejection(
      Parse.Cloud.run('verifyemail', { email: uniqueEmail('anon'), otp: OTP_VALUE })
    );

    expect(error.code).toBe(Parse.Error.INVALID_SESSION_TOKEN);
    expect(error.message).toBe('User is not authenticated.');
  });

  it('marks the email as verified when the otp matches', async () => {
    const account = await createPlainUser(uniqueEmail('verify-ok'));
    await createOtpRecord(account.email);

    const result = await verifyAs(account, { email: account.email, otp: OTP_VALUE });

    expect(result).toEqual({ message: 'Email is verified.' });
    expect(await readEmailVerified(account.id)).toBeTrue();
  });

  it('accepts the otp when it is sent as a number', async () => {
    const account = await createPlainUser(uniqueEmail('verify-number'));
    await createOtpRecord(account.email);

    const result = await verifyAs(account, { email: account.email, otp: Number(OTP_VALUE) });

    expect(result.message).toBe('Email is verified.');
  });

  it('accepts the email regardless of casing and surrounding whitespace', async () => {
    const account = await createPlainUser(uniqueEmail('verify-casing'));
    await createOtpRecord(account.email);

    const result = await verifyAs(account, {
      email: ` ${account.email.toUpperCase()} `,
      otp: OTP_VALUE,
    });

    expect(result.message).toBe('Email is verified.');
  });

  it('answers that the email is already verified', async () => {
    const account = await createPlainUser(uniqueEmail('verify-twice'));
    await createOtpRecord(account.email);
    await markVerified(account.id);

    const result = await verifyAs(account, { email: account.email, otp: OTP_VALUE });

    expect(result).toEqual({ message: 'Email is already verified.' });
  });

  it('rejects with a script failure when the otp is wrong', async () => {
    const account = await createPlainUser(uniqueEmail('verify-wrong'));
    await createOtpRecord(account.email);

    const error = await captureRejection(
      verifyAs(account, { email: account.email, otp: WRONG_OTP })
    );

    expect(error.code).toBe(Parse.Error.SCRIPT_FAILED);
    expect(error.message).toBe('OTP is invalid.');
    expect(await readEmailVerified(account.id)).toBeFalsy();
  });

  it('rejects with a script failure when no otp was issued for the email', async () => {
    const account = await createPlainUser(uniqueEmail('verify-none'));

    const error = await captureRejection(
      verifyAs(account, { email: account.email, otp: OTP_VALUE })
    );

    expect(error.code).toBe(Parse.Error.SCRIPT_FAILED);
    expect(error.message).toBe('OTP is invalid.');
  });

  it('rejects a non numeric otp and leaves the email unverified', async () => {
    const account = await createPlainUser(uniqueEmail('verify-nan'));
    await createOtpRecord(account.email);

    const error = await captureRejection(verifyAs(account, { email: account.email, otp: 'abcd' }));

    expect(error.code).toBe(Parse.Error.SCRIPT_FAILED);
    expect(error.message).toBe('OTP is invalid.');
    expect(await readEmailVerified(account.id)).toBeFalsy();
  });

  it('rejects a missing otp and leaves the email unverified', async () => {
    const account = await createPlainUser(uniqueEmail('verify-missing'));
    await createOtpRecord(account.email);

    const error = await captureRejection(verifyAs(account, { email: account.email }));

    expect(error.code).toBe(Parse.Error.SCRIPT_FAILED);
    expect(error.message).toBe('OTP is invalid.');
    expect(await readEmailVerified(account.id)).toBeFalsy();
  });

  it('propagates a failure of the otp lookup', async () => {
    const account = await createPlainUser(uniqueEmail('verify-lookup'));
    const lookup = rejectFirstFor('defaultdata_Otp', new Parse.Error(141, 'lookup failed'));

    const error = await captureRejection(
      verifyAs(account, { email: account.email, otp: OTP_VALUE })
    );

    expect(error.message).toBe('lookup failed');
    expect(lookup.hits()).toBe(1);
    expect(await readEmailVerified(account.id)).toBeFalsy();
  });

  describe('session hygiene after a successful verification', () => {
    it('revokes the other password sessions and keeps the current one', async () => {
      const account = await createPlainUser(uniqueEmail('verify-sessions'));
      await createOtpRecord(account.email);
      const otherToken = await openPasswordSessionBypassingGate(account.id, account.email);
      const serverToken = await createMasterKeySession(account.id);

      await verifyAs(account, { email: account.email, otp: OTP_VALUE });

      expect(await isSessionValid(account.sessionToken)).toBeTrue();
      expect(await isSessionValid(otherToken)).toBeFalse();
      expect(await isSessionValid(serverToken)).toBeTrue();
    });

    it('does not rotate the password of the caller', async () => {
      const account = await createPlainUser(uniqueEmail('verify-password'));
      await createOtpRecord(account.email);

      await verifyAs(account, { email: account.email, otp: OTP_VALUE });

      expect(await loginRejected(account.email, PASSWORD)).toBeFalse();
    });

    it('removes the provider credentials of the account', async () => {
      const account = await createPlainUser(uniqueEmail('verify-authdata'));
      await createOtpRecord(account.email);
      const user = await new Parse.Query(Parse.User).get(account.id, { useMasterKey: true });
      user.set('authData', { anonymous: { id: uniqueEmail('anon') } });
      await user.save(null, { useMasterKey: true });

      await verifyAs(account, { email: account.email, otp: OTP_VALUE });

      const stored = await new Parse.Query(Parse.User).get(account.id, { useMasterKey: true });
      expect(stored.get('authData')).toBeFalsy();
    });

    it('does not revoke any session when the otp is wrong', async () => {
      const account = await createPlainUser(uniqueEmail('verify-keep'));
      await createOtpRecord(account.email);
      const otherToken = await openPasswordSessionBypassingGate(account.id, account.email);

      await captureRejection(verifyAs(account, { email: account.email, otp: WRONG_OTP }));

      expect(await isSessionValid(otherToken)).toBeTrue();
    });
  });

  describe('defensive branches (unreachable via public API)', () => {
    it('rejects with a script failure when the saved user comes back empty', async () => {
      const account = await createPlainUser(uniqueEmail('verify-empty-save'));
      await createOtpRecord(account.email);
      const userSave = spyOn(Parse.User.prototype, 'save').and.resolveTo(undefined);

      const error = await captureRejection(
        verifyAs(account, { email: account.email, otp: OTP_VALUE })
      );

      expect(error.code).toBe(Parse.Error.SCRIPT_FAILED);
      expect(error.message).toBe('Something went wrong, please try again later!');
      expect(userSave).toHaveBeenCalledTimes(1);
    });
  });

  describe('ownership, expiry, lockout and one-time use', () => {
    it('does not verify the account with an otp issued for a different email', async () => {
      const account = await createPlainUser(uniqueEmail('verify-victim'));
      const otherEmail = uniqueEmail('verify-attacker-owned');
      await createOtpRecord(otherEmail);

      const error = await captureRejection(
        verifyAs(account, { email: otherEmail, otp: OTP_VALUE })
      );

      expect(error).not.toBeNull();
      expect(error.message).toBe('OTP is invalid.');
      expect(await readEmailVerified(account.id)).toBeFalsy();
    });

    it('leaves the otp of the other email untouched when the email does not match the caller', async () => {
      const account = await createPlainUser(uniqueEmail('verify-bystander'));
      const otherEmail = uniqueEmail('verify-other-owner');
      await createOtpRecord(otherEmail);

      await captureRejection(verifyAs(account, { email: otherEmail, otp: WRONG_OTP }));

      const stored = await findOtpRecord(otherEmail);
      expect(stored.get('FailedAttempts')).toBe(0);
      expect(stored.get('OtpHash')).toBeDefined();
    });

    it('rejects when the email is missing', async () => {
      const account = await createPlainUser(uniqueEmail('verify-no-email'));
      await createOtpRecord(account.email);

      const error = await captureRejection(verifyAs(account, { otp: OTP_VALUE }));

      expect(error.message).toBe('OTP is invalid.');
      expect(await readEmailVerified(account.id)).toBeFalsy();
    });

    it('rejects an expired otp', async () => {
      const account = await createPlainUser(uniqueEmail('verify-expired'));
      await createOtpRecord(account.email, { ExpiresAt: new Date(Date.now() - 60 * 1000) });

      const error = await captureRejection(
        verifyAs(account, { email: account.email, otp: OTP_VALUE })
      );

      expect(error.message).toBe('OTP is invalid.');
      expect(await readEmailVerified(account.id)).toBeFalsy();
    });

    it('counts a wrong otp as a failed attempt', async () => {
      const account = await createPlainUser(uniqueEmail('verify-count'));
      await createOtpRecord(account.email);

      await captureRejection(verifyAs(account, { email: account.email, otp: WRONG_OTP }));

      expect((await findOtpRecord(account.email)).get('FailedAttempts')).toBe(1);
    });

    it('refuses even the correct otp after too many wrong attempts', async () => {
      const account = await createPlainUser(uniqueEmail('verify-lockout'));
      await createOtpRecord(account.email, { FailedAttempts: OTP_MAX_FAILED_ATTEMPTS });

      const error = await captureRejection(
        verifyAs(account, { email: account.email, otp: OTP_VALUE })
      );

      expect(error.message).toBe('OTP is invalid.');
      expect(await readEmailVerified(account.id)).toBeFalsy();
    });

    it('does not accept the same otp twice', async () => {
      const account = await createPlainUser(uniqueEmail('verify-replay'));
      await createOtpRecord(account.email);
      await verifyAs(account, { email: account.email, otp: OTP_VALUE });

      const error = await captureRejection(
        verifyAs(account, { email: account.email, otp: OTP_VALUE })
      );

      expect(error.message).toBe('OTP is invalid.');
    });
  });
});
