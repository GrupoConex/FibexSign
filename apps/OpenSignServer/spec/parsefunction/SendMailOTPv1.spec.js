import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { knownDefect } from '../utils/known-defect.js';
import sendMailOTPv1 from '../../cloud/parsefunction/SendMailOTPv1.js';
import { smtpenable } from '../../Utils.js';
import {
  captureRejection,
  createExtUser,
  createOtpRecord,
  createPlainUser,
  findOtpRecord,
  rejectFirstFor,
  resetAuthState,
  silenceConsole,
  stubFirstFor,
  uniqueEmail,
  waitUntil,
} from '../utils/auth-fixtures.js';

const run = promisify(execFile);
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PROBE_PATH = fileURLToPath(new URL('../utils/otp-sender-probe.mjs', import.meta.url));
const SMTP_SENDER = 'smtp-sender@example.com';
const MAILGUN_SENDER = 'mailgun-sender@example.com';
const PROBE_TIMEOUT_MS = 25000;
const PROBE_SPEC_TIMEOUT_MS = 30000;
const EMAIL_COUNT_WAIT_MS = 2000;
const TEN_MINUTES_MS = 10 * 60 * 1000;
const MASTER = { useMasterKey: true };

const sendOtp = params => Parse.Cloud.run('SendOTPMailV1', params);

const documentOwnedBy = extUserId => ({
  toJSON: () => ({ ExtUserPtr: { objectId: extUserId } }),
});

describe('SendOTPMailV1 cloud function', () => {
  let sendEmailSpy;
  let previousEnv;

  beforeEach(async () => {
    silenceConsole();
    await resetAuthState();
    previousEnv = {
      smtp: process.env.SMTP_USER_EMAIL,
      mailgun: process.env.MAILGUN_SENDER,
    };
    process.env.SMTP_USER_EMAIL = SMTP_SENDER;
    process.env.MAILGUN_SENDER = MAILGUN_SENDER;
    sendEmailSpy = spyOn(Parse.Cloud, 'sendEmail').and.resolveTo();
  });

  afterEach(async () => {
    const restore = (key, value) =>
      value === undefined ? delete process.env[key] : (process.env[key] = value);
    restore('SMTP_USER_EMAIL', previousEnv.smtp);
    restore('MAILGUN_SENDER', previousEnv.mailgun);
    await resetAuthState();
  });

  it('asks for a valid email when none is provided', async () => {
    const result = await sendOtp({});

    expect(result).toBe('Please Enter valid email');
    expect(sendEmailSpy).not.toHaveBeenCalled();
  });

  it('asks for a valid email when the email is an empty string', async () => {
    const result = await sendOtp({ email: '' });

    expect(result).toBe('Please Enter valid email');
    expect(sendEmailSpy).not.toHaveBeenCalled();
  });

  it('sends the otp email to the recipient with the configured sender', async () => {
    const email = uniqueEmail('otp-send');

    const result = await sendOtp({ email });

    const expectedSender = smtpenable ? SMTP_SENDER : MAILGUN_SENDER;
    const payload = sendEmailSpy.calls.mostRecent().args[0];
    expect(result).toBe('Otp send');
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(payload.recipient).toBe(email);
    expect(payload.sender).toBe(`Firma <${expectedSender}>`);
    expect(payload.subject).toBe('Your Firma OTP');
  });

  it(
    'uses the opposite sender configuration when smtp is toggled in a fresh process',
    async () => {
      const { stdout } = await run(process.execPath, [PROBE_PATH], {
        cwd: REPO_ROOT,
        timeout: PROBE_TIMEOUT_MS,
        env: {
          ...process.env,
          SMTP_ENABLE: String(!smtpenable),
          SMTP_USER_EMAIL: SMTP_SENDER,
          MAILGUN_SENDER,
        },
      });

      const probe = JSON.parse(stdout.split('PROBE:')[1]);
      const expectedSender = smtpenable ? MAILGUN_SENDER : SMTP_SENDER;
      expect(probe.result).toBe('Otp send');
      expect(probe.sender).toBe(`Firma <${expectedSender}>`);
    },
    PROBE_SPEC_TIMEOUT_MS
  );

  it('embeds the persisted otp code in the email body', async () => {
    const email = uniqueEmail('otp-body');

    await sendOtp({ email });

    const stored = await findOtpRecord(email);
    const payload = sendEmailSpy.calls.mostRecent().args[0];
    expect(payload.html).toContain(String(stored.get('OTP')));
  });

  it('stores a four digit otp valid for ten minutes with no failed attempts', async () => {
    const email = uniqueEmail('otp-store');
    const before = Date.now();

    await sendOtp({ email });

    const stored = await findOtpRecord(email);
    const expiresAt = stored.get('ExpiresAt').getTime();
    expect(stored.get('OTP')).toBeGreaterThanOrEqual(1000);
    expect(stored.get('OTP')).toBeLessThanOrEqual(9999);
    expect(stored.get('FailedAttempts')).toBe(0);
    expect(expiresAt).toBeGreaterThanOrEqual(before + TEN_MINUTES_MS);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + TEN_MINUTES_MS);
  });

  it('stores the tenant id when it is provided', async () => {
    const email = uniqueEmail('otp-tenant');

    await sendOtp({ email, TenantId: 'tenant-123' });

    const stored = await findOtpRecord(email);
    expect(stored.get('TenantId')).toBe('tenant-123');
  });

  it('leaves the tenant id unset when it is not provided', async () => {
    const email = uniqueEmail('otp-no-tenant');

    await sendOtp({ email });

    const stored = await findOtpRecord(email);
    expect(stored.get('TenantId')).toBeUndefined();
  });

  it('refreshes an existing otp record instead of creating another one', async () => {
    const email = uniqueEmail('otp-refresh');
    const existing = await createOtpRecord(email, {
      OTP: 1000,
      FailedAttempts: 4,
      ExpiresAt: new Date(Date.now() - 1000),
    });

    const result = await sendOtp({ email });

    const query = new Parse.Query('defaultdata_Otp');
    query.equalTo('Email', email);
    const records = await query.find(MASTER);
    expect(result).toBe('Otp send');
    expect(records.length).toBe(1);
    expect(records[0].id).toBe(existing.id);
    expect(records[0].get('FailedAttempts')).toBe(0);
    expect(records[0].get('ExpiresAt').getTime()).toBeGreaterThan(Date.now());
  });

  it('still stores the otp and answers success when the email transport fails', async () => {
    const email = uniqueEmail('otp-transport');
    sendEmailSpy.and.rejectWith(new Error('smtp unavailable'));

    const result = await sendOtp({ email });

    expect(result).toBe('Otp send');
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect((await findOtpRecord(email))?.get('Email')).toBe(email);
  });

  it('increments the email counter of the document owner when a docId is provided', async () => {
    const account = await createPlainUser(uniqueEmail('otp-owner'));
    const owner = await createExtUser({ account, role: 'contracts_Admin' });
    const documentLookup = stubFirstFor('contracts_Document', documentOwnedBy(owner.id));

    const result = await sendOtp({ email: uniqueEmail('otp-doc'), docId: 'doc-1' });

    const counted = await waitUntil(
      async () => {
        const reloaded = await new Parse.Query('contracts_Users').get(owner.id, MASTER);
        return reloaded.get('EmailCount') === 1;
      },
      { timeoutMs: EMAIL_COUNT_WAIT_MS }
    );
    expect(result).toBe('Otp send');
    expect(documentLookup.hits()).toBe(1);
    expect(counted).toBeTrue();
  });

  describe('document owner lookup outcomes', () => {
    const expectOtpDeliveredAndStored = async (result, email) => {
      expect(result).toBe('Otp send');
      expect(sendEmailSpy).toHaveBeenCalledTimes(1);
      expect((await findOtpRecord(email))?.get('Email')).toBe(email);
    };

    it('does not fail when the document of the docId does not exist', async () => {
      const email = uniqueEmail('otp-missing-doc');
      const documentLookup = stubFirstFor('contracts_Document', undefined);

      const result = await sendOtp({ email, docId: 'missing' });

      expect(documentLookup.hits()).toBe(1);
      await expectOtpDeliveredAndStored(result, email);
    });

    it('does not fail when the document has no owner', async () => {
      const email = uniqueEmail('otp-no-owner');
      const documentLookup = stubFirstFor('contracts_Document', { toJSON: () => ({}) });

      const result = await sendOtp({ email, docId: 'orphan' });

      expect(documentLookup.hits()).toBe(1);
      await expectOtpDeliveredAndStored(result, email);
    });

    it('does not fail when the document lookup throws', async () => {
      const email = uniqueEmail('otp-doc-error');
      const documentLookup = rejectFirstFor('contracts_Document', new Error('lookup failed'));

      const result = await sendOtp({ email, docId: 'broken' });

      expect(documentLookup.hits()).toBe(1);
      await expectOtpDeliveredAndStored(result, email);
    });
  });

  it(
    'rejects instead of resolving with the error when the otp lookup fails',
    knownDefect(
      'DEF-02',
      'sendMailOTPv1 swallows internal failures and resolves with the caught error object as a value',
      async check => {
        const failure = new Error('otp lookup failed');
        const lookup = rejectFirstFor('defaultdata_Otp', failure);

        const outcome = await captureRejection(
          sendMailOTPv1({ params: { email: uniqueEmail('otp-lookup') } })
        );

        check(lookup.hits() === 1, 'the otp lookup must run');
        check(outcome === failure, 'must reject with the original failure');
      }
    )
  );

  it(
    'rejects instead of resolving with the error when the request has no params',
    knownDefect(
      'DEF-02',
      'sendMailOTPv1 swallows internal failures and resolves with the caught error object as a value',
      async check => {
        const outcome = await captureRejection(sendMailOTPv1({}));

        check(outcome !== null, 'must reject when the request is malformed');
      }
    )
  );
});
