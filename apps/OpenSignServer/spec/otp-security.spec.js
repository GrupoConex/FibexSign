import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function createTestUser(email) {
  const user = new Parse.User();
  user.set('username', email);
  user.set('email', email);
  user.set('password', 'Str0ngPassw0rd!');
  await user.signUp();
  await Parse.User.logOut();
  return user;
}

async function readOtpRecord(email) {
  const query = new Parse.Query('defaultdata_Otp');
  query.equalTo('Email', email);
  return query.first({ useMasterKey: true });
}

describe('OTP login security hardening', () => {
  it('SendMailOTPv1.js no longer uses Math.random for OTP generation', () => {
    const filePath = path.join(__dirname, '../cloud/parsefunction/SendMailOTPv1.js');
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).not.toContain('Math.random');
  });

  it('persists an OTP always within the 1000-9999 range', async () => {
    const email = `otp-range-${Date.now()}@example.com`;
    await Parse.Cloud.run('SendOTPMailV1', { email });
    const first = await readOtpRecord(email);
    expect(first.get('OTP')).toBeGreaterThanOrEqual(1000);
    expect(first.get('OTP')).toBeLessThanOrEqual(9999);

    await Parse.Cloud.run('SendOTPMailV1', { email });
    const second = await readOtpRecord(email);
    expect(second.get('OTP')).toBeGreaterThanOrEqual(1000);
    expect(second.get('OTP')).toBeLessThanOrEqual(9999);
  });

  it('locks out an email after repeated wrong OTP attempts, even blocking the real OTP afterward', async () => {
    const email = `otp-lockout-${Date.now()}@example.com`;
    await createTestUser(email);
    await Parse.Cloud.run('SendOTPMailV1', { email });
    const record = await readOtpRecord(email);
    const realOtp = record.get('OTP');
    const wrongOtp = realOtp === 9999 ? 1000 : realOtp + 1;

    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await Parse.Cloud.run('AuthLoginAsMail', { email, otp: wrongOtp });
      expect(result).toBe('Invalid Otp');
    }

    const lockedOutResult = await Parse.Cloud.run('AuthLoginAsMail', { email, otp: realOtp });
    expect(lockedOutResult).toBe('Invalid Otp');
  });

  it('rejects an expired OTP even when the guessed value is correct', async () => {
    const email = `otp-expired-${Date.now()}@example.com`;
    await createTestUser(email);
    const otpClass = Parse.Object.extend('defaultdata_Otp');
    const expiredOtp = new otpClass();
    expiredOtp.set('OTP', 4242);
    expiredOtp.set('Email', email);
    expiredOtp.set('ExpiresAt', new Date(Date.now() - 60 * 1000));
    expiredOtp.set('FailedAttempts', 0);
    await expiredOtp.save(null, { useMasterKey: true });

    const result = await Parse.Cloud.run('AuthLoginAsMail', { email, otp: 4242 });
    expect(result).toBe('Invalid Otp');
  });

  it('succeeds on a freshly requested, non-expired, first-attempt correct OTP', async () => {
    const email = `otp-success-${Date.now()}@example.com`;
    const user = await createTestUser(email);
    await Parse.Cloud.run('SendOTPMailV1', { email });
    const record = await readOtpRecord(email);
    const realOtp = record.get('OTP');

    const result = await Parse.Cloud.run('AuthLoginAsMail', { email, otp: realOtp });
    expect(result.sessionToken).toBeDefined();
    expect(result.objectId).toBe(user.id);
  });
});
