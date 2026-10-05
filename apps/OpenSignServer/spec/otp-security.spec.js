import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashOtp } from '../cloud/parsefunction/shared/otpPolicy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CODE_PATTERN = />(\d{6})<\/p>/;
const WRONG_OTP = '111111';

async function createTestUser(email) {
  const user = new Parse.User();
  user.set('username', email);
  user.set('email', email);
  user.set('password', 'Str0ngPassw0rd!');
  await user.signUp(null, { useMasterKey: true });
  await Parse.User.logOut();
  return user;
}

async function readOtpRecord(email) {
  const query = new Parse.Query('defaultdata_Otp');
  query.equalTo('Email', email);
  return query.first({ useMasterKey: true });
}

describe('OTP login security hardening', () => {
  let sendEmailSpy;

  const deliveredCode = () => sendEmailSpy.calls.mostRecent().args[0].html.match(CODE_PATTERN)[1];

  beforeEach(() => {
    spyOn(console, 'log');
    sendEmailSpy = spyOn(Parse.Cloud, 'sendEmail').and.resolveTo();
  });

  it('SendMailOTPv1.js no longer uses Math.random for OTP generation', () => {
    const filePath = path.join(__dirname, '../cloud/parsefunction/SendMailOTPv1.js');
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).not.toContain('Math.random');
  });

  it('delivers a six digit OTP and persists only its hash on every send', async () => {
    const email = `otp-range-${Date.now()}@example.com`;

    await Parse.Cloud.run('SendOTPMailV1', { email });
    const firstCode = deliveredCode();
    const first = await readOtpRecord(email);
    await Parse.Cloud.run('SendOTPMailV1', { email });
    const secondCode = deliveredCode();
    const second = await readOtpRecord(email);

    expect(firstCode).toMatch(/^\d{6}$/);
    expect(first.get('OtpHash')).toBe(hashOtp(firstCode));
    expect(first.get('OTP')).toBeUndefined();
    expect(secondCode).toMatch(/^\d{6}$/);
    expect(second.get('OtpHash')).toBe(hashOtp(secondCode));
  });

  it('locks out an email after repeated wrong OTP attempts, even blocking the real OTP afterward', async () => {
    const email = `otp-lockout-${Date.now()}@example.com`;
    await createTestUser(email);
    await Parse.Cloud.run('SendOTPMailV1', { email });
    const realOtp = deliveredCode();

    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await Parse.Cloud.run('AuthLoginAsMail', { email, otp: WRONG_OTP });
      expect(result).toBe('Invalid Otp');
    }

    const lockedOutResult = await Parse.Cloud.run('AuthLoginAsMail', { email, otp: realOtp });
    expect(lockedOutResult).toBe('Invalid Otp');
  });

  it('does not let a resend unlock an email that was locked out', async () => {
    const email = `otp-resend-locked-${Date.now()}@example.com`;
    await createTestUser(email);
    await Parse.Cloud.run('SendOTPMailV1', { email });
    for (let attempt = 0; attempt < 5; attempt++) {
      await Parse.Cloud.run('AuthLoginAsMail', { email, otp: WRONG_OTP });
    }

    await Parse.Cloud.run('SendOTPMailV1', { email });
    const result = await Parse.Cloud.run('AuthLoginAsMail', { email, otp: deliveredCode() });

    expect(result).toBe('Invalid Otp');
  });

  it('rejects an expired OTP even when the guessed value is correct', async () => {
    const email = `otp-expired-${Date.now()}@example.com`;
    await createTestUser(email);
    const otpClass = Parse.Object.extend('defaultdata_Otp');
    const expiredOtp = new otpClass();
    expiredOtp.set('OtpHash', hashOtp('424242'));
    expiredOtp.set('Email', email);
    expiredOtp.set('ExpiresAt', new Date(Date.now() - 60 * 1000));
    expiredOtp.set('FailedAttempts', 0);
    await expiredOtp.save(null, { useMasterKey: true });

    const result = await Parse.Cloud.run('AuthLoginAsMail', { email, otp: '424242' });
    expect(result).toBe('Invalid Otp');
  });

  it('succeeds on a freshly requested, non-expired, first-attempt correct OTP', async () => {
    const email = `otp-success-${Date.now()}@example.com`;
    const user = await createTestUser(email);
    await Parse.Cloud.run('SendOTPMailV1', { email });

    const result = await Parse.Cloud.run('AuthLoginAsMail', { email, otp: deliveredCode() });
    expect(result.sessionToken).toBeDefined();
    expect(result.objectId).toBe(user.id);
  });

  it('refuses the same OTP a second time', async () => {
    const email = `otp-once-${Date.now()}@example.com`;
    await createTestUser(email);
    await Parse.Cloud.run('SendOTPMailV1', { email });
    const otp = deliveredCode();
    await Parse.Cloud.run('AuthLoginAsMail', { email, otp });

    const replay = await Parse.Cloud.run('AuthLoginAsMail', { email, otp });

    expect(replay).toBe('Invalid Otp');
  });
});
