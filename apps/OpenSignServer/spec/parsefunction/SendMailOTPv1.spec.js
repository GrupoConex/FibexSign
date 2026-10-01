import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sendMailOTPv1 from '../../cloud/parsefunction/SendMailOTPv1.js';
import {
  OTP_MAX_FAILED_ATTEMPTS,
  OTP_RESEND_LIMIT,
  OTP_RESEND_WINDOW_MS,
  OTP_TTL_MS,
  hashOtp,
} from '../../cloud/parsefunction/shared/otpPolicy.js';
import { smtpenable } from '../../Utils.js';
import {
  captureConsoleError,
  captureRejection,
  createExtUser,
  createOtpRecord,
  createPlainUser,
  findOtpRecord,
  rejectFirstFor,
  rejectSaveFor,
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
const SIX_DIGIT_CODE_PATTERN = />(\d{6})<\/p>/;
const LIMIT_MESSAGE = 'Too many OTP requests. Please try again later.';
const SEND_FAILURE_MESSAGE = 'Could not send the OTP email. Please try again later.';
const INTERNAL_FAILURE_MESSAGE = 'Could not process the OTP request. Please try again later.';
const MASTER = { useMasterKey: true };
const PARALLEL_REQUESTS = 8;

const sendOtp = params => Parse.Cloud.run('SendOTPMailV1', params);

const sentCode = spy => spy.calls.mostRecent().args[0].html.match(SIX_DIGIT_CODE_PATTERN)[1];

const documentOwnedBy = extUserId => ({
  toJSON: () => ({ ExtUserPtr: { objectId: extUserId } }),
});

describe('SendOTPMailV1 cloud function', () => {
  let sendEmailSpy;
  let consoleError;
  let previousEnv;

  const exhaustResendLimit = async email => {
    for (let sent = 0; sent < OTP_RESEND_LIMIT; sent += 1) {
      await sendOtp({ email });
    }
  };

  beforeEach(async () => {
    silenceConsole();
    consoleError = captureConsoleError();
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

  [' ', '   ', 42, { $ne: '' }, ['a@b.c']].forEach(email => {
    it(`asks for a valid email when the email is ${JSON.stringify(email)}`, async () => {
      const result = await sendOtp({ email });

      expect(result).toBe('Please Enter valid email');
      expect(sendEmailSpy).not.toHaveBeenCalled();
    });
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

  it('embeds in the email body the code whose hash is persisted', async () => {
    const email = uniqueEmail('otp-body');

    await sendOtp({ email });

    const stored = await findOtpRecord(email);
    expect(stored.get('OtpHash')).toBe(hashOtp(sentCode(sendEmailSpy)));
  });

  it('stores a six digit otp only as a hash valid for ten minutes with no failed attempts', async () => {
    const email = uniqueEmail('otp-store');
    const before = Date.now();

    await sendOtp({ email });

    const stored = await findOtpRecord(email);
    const expiresAt = stored.get('ExpiresAt').getTime();
    expect(sentCode(sendEmailSpy)).toMatch(/^\d{6}$/);
    expect(stored.get('OtpHash')).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.get('OTP')).toBeUndefined();
    expect(stored.get('FailedAttempts')).toBe(0);
    expect(expiresAt).toBeGreaterThanOrEqual(before + OTP_TTL_MS);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + OTP_TTL_MS);
  });

  it('never stores the plaintext code in the record', async () => {
    const email = uniqueEmail('otp-plaintext');

    await sendOtp({ email });

    const stored = await findOtpRecord(email);
    expect(JSON.stringify(stored.toJSON())).not.toContain(sentCode(sendEmailSpy));
  });

  it('normalizes the recipient email before storing and sending', async () => {
    const email = uniqueEmail('otp-normalize');

    await sendOtp({ email: `  ${email.toUpperCase()} ` });

    expect(sendEmailSpy.calls.mostRecent().args[0].recipient).toBe(email);
    expect((await findOtpRecord(email))?.get('Email')).toBe(email);
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
      otp: 100000,
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

  it('rejects with a controlled error and never reports success when the email transport fails', async () => {
    const email = uniqueEmail('otp-transport');
    const transportFailure = new Error('smtp unavailable');
    sendEmailSpy.and.rejectWith(transportFailure);

    const error = await captureRejection(sendOtp({ email }));

    expect(error.code).toBe(Parse.Error.INTERNAL_SERVER_ERROR);
    expect(error.message).toBe(SEND_FAILURE_MESSAGE);
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith('error in send OTP mail', transportFailure);
  });

  it('does not touch the document owner counter when the email transport fails', async () => {
    const documentLookup = stubFirstFor('contracts_Document', documentOwnedBy('owner-1'));
    sendEmailSpy.and.rejectWith(new Error('smtp unavailable'));

    await captureRejection(sendOtp({ email: uniqueEmail('otp-transport-doc'), docId: 'doc-1' }));

    expect(documentLookup.hits()).toBe(0);
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

  describe('internal failures', () => {
    it('rejects with the original Parse error when the otp lookup fails', async () => {
      const failure = new Parse.Error(Parse.Error.SCRIPT_FAILED, 'otp lookup failed');
      const lookup = rejectFirstFor('defaultdata_Otp', failure);

      const outcome = await captureRejection(
        sendMailOTPv1({ params: { email: uniqueEmail('otp-lookup') } })
      );

      expect(lookup.hits()).toBe(1);
      expect(outcome).toBe(failure);
    });

    it('rejects with a controlled error that hides unexpected failures', async () => {
      const failure = new Error('otp lookup failed');
      rejectFirstFor('defaultdata_Otp', failure);

      const outcome = await captureRejection(
        sendMailOTPv1({ params: { email: uniqueEmail('otp-lookup-raw') } })
      );

      expect(outcome instanceof Parse.Error).toBeTrue();
      expect(outcome.code).toBe(Parse.Error.INTERNAL_SERVER_ERROR);
      expect(outcome.message).toBe(INTERNAL_FAILURE_MESSAGE);
      expect(consoleError).toHaveBeenCalledWith('err in sendMailOTPv1', failure);
    });

    it('rejects with a controlled error when the request has no params', async () => {
      const outcome = await captureRejection(sendMailOTPv1({}));

      expect(outcome instanceof Parse.Error).toBeTrue();
      expect(outcome.message).toBe(INTERNAL_FAILURE_MESSAGE);
    });

    it('rejects with a controlled error and sends nothing when the otp cannot be stored', async () => {
      rejectSaveFor('defaultdata_Otp', new Error('db down'));

      const outcome = await captureRejection(sendOtp({ email: uniqueEmail('otp-store-fail') }));

      expect(outcome.message).toBe(INTERNAL_FAILURE_MESSAGE);
      expect(sendEmailSpy).not.toHaveBeenCalled();
    });
  });

  describe('resend limit', () => {
    it('allows three sends per recipient inside the window and rejects the fourth', async () => {
      const email = uniqueEmail('otp-limit');
      await exhaustResendLimit(email);

      const error = await captureRejection(sendOtp({ email }));

      expect(error.code).toBe(Parse.Error.REQUEST_LIMIT_EXCEEDED);
      expect(error.message).toBe(LIMIT_MESSAGE);
      expect(sendEmailSpy).toHaveBeenCalledTimes(OTP_RESEND_LIMIT);
    });

    it('delivers at most three emails when several requests arrive in parallel', async () => {
      const email = uniqueEmail('otp-limit-parallel');

      const outcomes = await Promise.allSettled(
        Array.from({ length: PARALLEL_REQUESTS }, () => sendOtp({ email }))
      );

      const delivered = outcomes.filter(outcome => outcome.status === 'fulfilled');
      const refused = outcomes.filter(outcome => outcome.status === 'rejected');
      const query = new Parse.Query('defaultdata_Otp');
      query.equalTo('Email', email);
      expect(delivered.length).toBe(OTP_RESEND_LIMIT);
      expect(sendEmailSpy).toHaveBeenCalledTimes(OTP_RESEND_LIMIT);
      expect(
        refused.every(outcome => outcome.reason.code === Parse.Error.REQUEST_LIMIT_EXCEEDED)
      ).toBeTrue();
      expect(await query.count(MASTER)).toBe(1);
    });

    it('keeps the last delivered code stored after a rejected resend', async () => {
      const email = uniqueEmail('otp-limit-keep');
      await exhaustResendLimit(email);
      const lastDelivered = sentCode(sendEmailSpy);

      await captureRejection(sendOtp({ email }));

      expect((await findOtpRecord(email)).get('OtpHash')).toBe(hashOtp(lastDelivered));
    });

    it('limits each recipient independently', async () => {
      await exhaustResendLimit(uniqueEmail('otp-limit-a'));

      const result = await sendOtp({ email: uniqueEmail('otp-limit-b') });

      expect(result).toBe('Otp send');
    });

    it('applies the limit regardless of email casing', async () => {
      const email = uniqueEmail('otp-limit-case');
      await exhaustResendLimit(email);

      const error = await captureRejection(sendOtp({ email: email.toUpperCase() }));

      expect(error.code).toBe(Parse.Error.REQUEST_LIMIT_EXCEEDED);
    });

    it('allows sending again once the window has expired', async () => {
      const email = uniqueEmail('otp-limit-window');
      await exhaustResendLimit(email);
      const row = await findOtpRecord(email);
      row.set('SendWindowStart', new Date(Date.now() - OTP_RESEND_WINDOW_MS - 1000));
      await row.save(null, MASTER);

      const result = await sendOtp({ email });

      expect(result).toBe('Otp send');
      expect((await findOtpRecord(email)).get('SendCount')).toBe(1);
    });

    it('does not reset the failed attempts when resending inside the window', async () => {
      const email = uniqueEmail('otp-limit-failures');
      await createOtpRecord(email, {
        FailedAttempts: OTP_MAX_FAILED_ATTEMPTS,
        SendCount: 1,
        SendWindowStart: new Date(),
      });

      await sendOtp({ email });

      expect((await findOtpRecord(email)).get('FailedAttempts')).toBe(OTP_MAX_FAILED_ATTEMPTS);
    });
  });
});
