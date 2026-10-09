import {
  OtpStatus,
  issueOtp,
  verifyAndConsumeOtp,
} from '../../cloud/parsefunction/shared/otpPolicy.js';
import {
  createDeletableAdmin,
  findDeleteOtpRow,
  requestDeleteOtp,
  useCommsMailCapture,
} from '../utils/delete-account-fixtures.js';
import { captureRejection, resetAuthState, silenceConsole } from '../utils/auth-fixtures.js';

const WRONG_CODE = '000001';
const ATTEMPTS_PAST_LOCKOUT = 7;
const forgeKey = email => `delete-account:${email}`;

describe('OTP purpose cannot be chosen by public callers', () => {
  const mail = useCommsMailCapture();
  let victim;

  beforeEach(async () => {
    silenceConsole();
    spyOn(console, 'error');
    await resetAuthState();
    victim = await createDeletableAdmin();
    await requestDeleteOtp(victim.account.id);
  });

  it('refuses SendOTPMailV1 for a forged purpose key and leaves the victim quota alone', async () => {
    const failure = await captureRejection(
      Parse.Cloud.run('SendOTPMailV1', { email: forgeKey(victim.account.email) })
    );

    const row = await findDeleteOtpRow(victim.account.email);
    expect(failure).not.toBeNull();
    expect(row.get('SendCount')).toBe(1);
    expect(mail.sent.length).toBe(1);
  });

  it('does not let AuthLoginAsMail burn the victim attempts', async () => {
    for (let attempt = 0; attempt < ATTEMPTS_PAST_LOCKOUT; attempt += 1) {
      await Parse.Cloud.run('AuthLoginAsMail', {
        email: forgeKey(victim.account.email),
        otp: WRONG_CODE,
      });
    }

    const row = await findDeleteOtpRow(victim.account.email);
    expect(row.get('FailedAttempts')).toBe(0);
  });

  it('treats a forged key as unknown when verifying', async () => {
    const status = await verifyAndConsumeOtp({
      email: forgeKey(victim.account.email),
      otp: WRONG_CODE,
    });

    expect(status).toBe(OtpStatus.NOT_FOUND);
    expect((await findDeleteOtpRow(victim.account.email)).get('FailedAttempts')).toBe(0);
  });

  it('refuses to issue a code for an address containing the key separator', async () => {
    const failure = await captureRejection(issueOtp({ email: forgeKey(victim.account.email) }));

    expect(failure.code).toBe(Parse.Error.VALIDATION_ERROR);
  });

  ['', '   ', 'not-an-email', 'a b@x.com'].forEach(email => {
    it(`refuses to issue a code for the malformed address "${email}"`, async () => {
      const failure = await captureRejection(issueOtp({ email }));

      expect(failure.code).toBe(Parse.Error.VALIDATION_ERROR);
    });
  });
});
