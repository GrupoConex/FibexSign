import {
  PASSWORD,
  TEST_OTP,
  buildSignupParams,
  buildUserDetails,
  captureRejection,
  createOtpRecord,
  findFirstByUserId,
  findOtpRecord,
  findUserByUsername,
  resetAuthState,
  silenceConsole,
} from '../utils/auth-fixtures.js';

const MASTER = { useMasterKey: true };
const WRONG_OTP = '111111';
const SIX_DIGIT_CODE_PATTERN = />(\d{6})<\/p>/;

const SIGNUP_FUNCTIONS = [
  { name: 'usersignup', role: 'contracts_User' },
  { name: 'addadmin', role: 'contracts_Admin' },
];

const countByEmail = async (className, field, email) => {
  const query = new Parse.Query(className);
  query.equalTo(field, email);
  return query.count(MASTER);
};

const expectNothingCreated = async email => {
  expect(await findUserByUsername(email)).toBeUndefined();
  expect(await countByEmail('partners_Tenant', 'EmailAddress', email)).toBe(0);
  expect(await countByEmail('contracts_Users', 'Email', email)).toBe(0);
};

SIGNUP_FUNCTIONS.forEach(({ name, role }) => {
  describe(`${name} email verification by OTP`, () => {
    let details;

    beforeEach(async () => {
      silenceConsole();
      await resetAuthState();
      details = buildUserDetails({ role });
    });

    afterEach(async () => {
      await resetAuthState();
    });

    it('rejects a missing otp and creates nothing', async () => {
      await createOtpRecord(details.email);

      const error = await captureRejection(Parse.Cloud.run(name, { userDetails: details }));

      expect(error.code).toBe(Parse.Error.VALIDATION_ERROR);
      expect(error.message).toBe('OTP is invalid.');
      await expectNothingCreated(details.email);
      expect((await findOtpRecord(details.email)).get('FailedAttempts')).toBe(0);
    });

    it('rejects a non string otp and creates nothing', async () => {
      await createOtpRecord(details.email);

      const error = await captureRejection(
        Parse.Cloud.run(name, { userDetails: details, otp: { $ne: '' } })
      );

      expect(error.code).toBe(Parse.Error.VALIDATION_ERROR);
      await expectNothingCreated(details.email);
    });

    it('rejects when no otp was ever issued for the email', async () => {
      const error = await captureRejection(
        Parse.Cloud.run(name, { userDetails: details, otp: TEST_OTP })
      );

      expect(error.code).toBe(Parse.Error.VALIDATION_ERROR);
      expect(error.message).toBe('OTP is invalid.');
      await expectNothingCreated(details.email);
    });

    it('rejects a wrong otp, counts the failed attempt and creates nothing', async () => {
      await createOtpRecord(details.email);

      const error = await captureRejection(
        Parse.Cloud.run(name, { userDetails: details, otp: WRONG_OTP })
      );

      expect(error.code).toBe(Parse.Error.VALIDATION_ERROR);
      expect(error.message).toBe('OTP is invalid.');
      await expectNothingCreated(details.email);
      expect((await findOtpRecord(details.email)).get('FailedAttempts')).toBe(1);
    });

    it('rejects an expired otp and creates nothing', async () => {
      await createOtpRecord(details.email, { ExpiresAt: new Date(Date.now() - 1000) });

      const error = await captureRejection(
        Parse.Cloud.run(name, { userDetails: details, otp: TEST_OTP })
      );

      expect(error.code).toBe(Parse.Error.VALIDATION_ERROR);
      expect(error.message).toBe('OTP is invalid.');
      await expectNothingCreated(details.email);
    });

    it('rejects a locked otp even when the code is right', async () => {
      await createOtpRecord(details.email, { FailedAttempts: 5 });

      const error = await captureRejection(
        Parse.Cloud.run(name, { userDetails: details, otp: TEST_OTP })
      );

      expect(error.code).toBe(Parse.Error.REQUEST_LIMIT_EXCEEDED);
      expect(error.message).toBe('Too many OTP attempts. Please try again later.');
      await expectNothingCreated(details.email);
    });

    it('validates the user details before consuming the otp', async () => {
      await createOtpRecord(details.email);

      const error = await captureRejection(
        Parse.Cloud.run(name, {
          userDetails: { ...details, name: '' },
          otp: WRONG_OTP,
        })
      );

      expect(error.code).toBe(Parse.Error.VALIDATION_ERROR);
      expect(error.message).toContain('name');
      expect((await findOtpRecord(details.email)).get('FailedAttempts')).toBe(0);
    });

    it('creates a verified account when the otp is valid', async () => {
      const params = await buildSignupParams(details);

      const result = await Parse.Cloud.run(name, params);

      const user = await findUserByUsername(details.email);
      expect(result.message).toBe('User sign up');
      expect(typeof result.sessionToken).toBe('string');
      expect(user.get('emailVerified')).toBeTrue();
      expect(await findFirstByUserId('partners_Tenant', user.id)).toBeDefined();
      expect(await findFirstByUserId('contracts_Users', user.id)).toBeDefined();
    });

    it('completes the sendotp then signup flow for an email without an account', async () => {
      const sendEmail = spyOn(Parse.Cloud, 'sendEmail').and.resolveTo();

      await Parse.Cloud.run('SendOTPMailV1', { email: details.email });
      const code = sendEmail.calls.mostRecent().args[0].html.match(SIX_DIGIT_CODE_PATTERN)[1];
      const result = await Parse.Cloud.run(name, { userDetails: details, otp: code });

      expect(result.message).toBe('User sign up');
      expect((await findUserByUsername(details.email)).get('emailVerified')).toBeTrue();
    });

    it('rejects a replayed otp after a successful signup', async () => {
      const params = await buildSignupParams(details);
      await Parse.Cloud.run(name, params);

      const replay = await captureRejection(
        Parse.Cloud.run(name, { userDetails: details, otp: TEST_OTP })
      );

      expect(replay).not.toBeNull();
      expect(await countByEmail('partners_Tenant', 'EmailAddress', details.email)).toBe(1);
    });

    it('rejects a reused otp for a second attempt on the same email', async () => {
      await createOtpRecord(details.email, { ConsumeCount: 1 });

      const error = await captureRejection(
        Parse.Cloud.run(name, { userDetails: details, otp: TEST_OTP })
      );

      expect(error.code).toBe(Parse.Error.VALIDATION_ERROR);
      await expectNothingCreated(details.email);
    });

    it('does not let an attacker sign up with a victim email without the victim otp', async () => {
      const victimOtp = '987654';
      await createOtpRecord(details.email, { otp: victimOtp });

      const attack = await captureRejection(
        Parse.Cloud.run(name, {
          userDetails: { ...details, password: 'Attacker-1!' },
          otp: TEST_OTP,
        })
      );

      expect(attack.code).toBe(Parse.Error.VALIDATION_ERROR);
      await expectNothingCreated(details.email);
      const owner = await Parse.Cloud.run(name, { userDetails: details, otp: victimOtp });
      expect(owner.message).toBe('User sign up');
      expect((await Parse.User.logIn(details.email, PASSWORD)).get('emailVerified')).toBeTrue();
    });
  });
});
