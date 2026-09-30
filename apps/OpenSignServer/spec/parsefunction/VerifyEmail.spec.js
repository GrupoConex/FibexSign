import { knownDefect } from '../utils/known-defect.js';
import {
  captureRejection,
  cloudRunAs,
  createOtpRecord,
  createPlainUser,
  rejectFirstFor,
  resetAuthState,
  silenceConsole,
  uniqueEmail,
} from '../utils/auth-fixtures.js';

const OTP_VALUE = 4242;

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
    await createOtpRecord(account.email, { OTP: OTP_VALUE });

    const result = await verifyAs(account, { email: account.email, otp: OTP_VALUE });

    expect(result).toEqual({ message: 'Email is verified.' });
    expect(await readEmailVerified(account.id)).toBeTrue();
  });

  it('accepts the otp when it is sent as a numeric string', async () => {
    const account = await createPlainUser(uniqueEmail('verify-string'));
    await createOtpRecord(account.email, { OTP: OTP_VALUE });

    const result = await verifyAs(account, { email: account.email, otp: String(OTP_VALUE) });

    expect(result.message).toBe('Email is verified.');
  });

  it('answers that the email is already verified', async () => {
    const account = await createPlainUser(uniqueEmail('verify-twice'));
    await createOtpRecord(account.email, { OTP: OTP_VALUE });
    await markVerified(account.id);

    const result = await verifyAs(account, { email: account.email, otp: OTP_VALUE });

    expect(result).toEqual({ message: 'Email is already verified.' });
  });

  it('rejects with a script failure when the otp is wrong', async () => {
    const account = await createPlainUser(uniqueEmail('verify-wrong'));
    await createOtpRecord(account.email, { OTP: OTP_VALUE });

    const error = await captureRejection(verifyAs(account, { email: account.email, otp: 1111 }));

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
    await createOtpRecord(account.email, { OTP: OTP_VALUE });

    const error = await captureRejection(verifyAs(account, { email: account.email, otp: 'abcd' }));

    expect(error.code).toBe(Parse.Error.SCRIPT_FAILED);
    expect(error.message).toBe('OTP is invalid.');
    expect(await readEmailVerified(account.id)).toBeFalsy();
  });

  it('rejects a missing otp and leaves the email unverified', async () => {
    const account = await createPlainUser(uniqueEmail('verify-missing'));
    await createOtpRecord(account.email, { OTP: OTP_VALUE });

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

  describe('defensive branches (unreachable via public API)', () => {
    it('rejects with a script failure when the saved user comes back empty', async () => {
      const account = await createPlainUser(uniqueEmail('verify-empty-save'));
      await createOtpRecord(account.email, { OTP: OTP_VALUE });
      const userSave = spyOn(Parse.User.prototype, 'save').and.resolveTo(undefined);

      const error = await captureRejection(
        verifyAs(account, { email: account.email, otp: OTP_VALUE })
      );

      expect(error.code).toBe(Parse.Error.SCRIPT_FAILED);
      expect(error.message).toBe('Something went wrong, please try again later!');
      expect(userSave).toHaveBeenCalledTimes(1);
    });
  });

  it(
    'does not verify the account with an otp issued for a different email',
    knownDefect(
      'SEC-02',
      'VerifyEmail does not bind the otp email to the calling user, so any issued otp verifies the caller',
      async check => {
        const account = await createPlainUser(uniqueEmail('verify-victim'));
        const otherEmail = uniqueEmail('verify-attacker-owned');
        await createOtpRecord(otherEmail, { OTP: OTP_VALUE });

        const error = await captureRejection(
          verifyAs(account, { email: otherEmail, otp: OTP_VALUE })
        );

        check(error !== null, 'must reject an otp that belongs to another email');
        check(!(await readEmailVerified(account.id)), 'caller must stay unverified');
      }
    )
  );

  it(
    'rejects an expired otp',
    knownDefect(
      'SEC-03',
      'VerifyEmail ignores ExpiresAt and FailedAttempts, unlike AuthLoginAsMail, so there is no expiry or lockout',
      async check => {
        const account = await createPlainUser(uniqueEmail('verify-expired'));
        await createOtpRecord(account.email, {
          OTP: OTP_VALUE,
          ExpiresAt: new Date(Date.now() - 60 * 1000),
        });

        const error = await captureRejection(
          verifyAs(account, { email: account.email, otp: OTP_VALUE })
        );

        check(error !== null, 'must reject an expired otp');
        check(!(await readEmailVerified(account.id)), 'caller must stay unverified');
      }
    )
  );
});
