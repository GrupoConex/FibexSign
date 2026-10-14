import fs from 'node:fs';
import {
  captureRejection,
  cloudRunAs,
  createCaller,
  purgeCreatedAccounts,
  silenceConsole,
} from '../utils/auth-fixtures.js';
import { useCommsMailCapture } from '../utils/delete-account-fixtures.js';
import { fileUrl, seedDocument } from '../utils/document-fixtures.js';
import { escapeHtml } from '../../cloud/parsefunction/shared/mailRendering.js';

const MASTER = { useMasterKey: true };
const INVALID_SESSION_TOKEN = 209;
const INVALID_QUERY = 102;
const OBJECT_NOT_FOUND = 101;
const MAIL_FAILURE = 400;
const GENERIC_MAIL_FAILURE = 'Could not send the document copy.';
const MAX_ACCEPTED_ENTRIES = 20;
const RECIPIENT = 'copy@example.com';
const SECOND_RECIPIENT = 'second@example.com';
const recipientsOf = count => Array.from({ length: count }, (_, index) => `r${index}@example.com`);

const forward = (params, account) => cloudRunAs('forwarddoc', params, account?.sessionToken);

const COMMS_ORIGIN = 'https://comms.test';
const PROVIDER_ERROR = 500;
const PROVIDER_ACCEPTED = 201;
const realFetch = globalThis.fetch;

const failFirstCommsDelivery = mail =>
  globalThis.fetch.and.callFake(async (url, init) => {
    if (!String(url).startsWith(COMMS_ORIGIN)) return realFetch(url, init);
    mail.sent.push(JSON.parse(init.body));
    const status = mail.sent.length === 1 ? PROVIDER_ERROR : PROVIDER_ACCEPTED;
    return { status, json: async () => ({ status: 'SENT' }) };
  });

const failCertificateCleanupWith = failure => {
  const originalExists = fs.existsSync;
  spyOn(fs, 'existsSync').and.callFake(path => {
    if (String(path).includes('certificate')) throw failure;
    return originalExists(path);
  });
};

const failCertificateCleanupOnce = failure => {
  const originalExists = fs.existsSync;
  let isArmed = true;
  spyOn(fs, 'existsSync').and.callFake(path => {
    if (isArmed && String(path).includes('certificate')) {
      isArmed = false;
      throw failure;
    }
    return originalExists(path);
  });
};

describe('forwarddoc', () => {
  const mail = useCommsMailCapture();
  let owner;

  beforeEach(async () => {
    silenceConsole();
    owner = await createCaller('contracts_Admin');
  });

  afterEach(async () => {
    await purgeCreatedAccounts();
  });

  it('rejects an anonymous caller without sending mail', async () => {
    const doc = await seedDocument(owner);

    const failure = await captureRejection(forward({ docId: doc.id, recipients: [RECIPIENT] }));

    expect(failure.code).toBe(INVALID_SESSION_TOKEN);
    expect(mail.sent).toEqual([]);
  });

  const invalidRequests = {
    'no document id': { recipients: [RECIPIENT] },
    'no recipients': { docId: 'someDocument' },
    'an empty recipient list': { docId: 'someDocument', recipients: [] },
    'more than ten recipients': { docId: 'someDocument', recipients: recipientsOf(11) },
  };
  Object.entries(invalidRequests).forEach(([label, params]) => {
    it(`rejects a request with ${label} as an invalid query`, async () => {
      const failure = await captureRejection(forward(params, owner.account));

      expect(failure.code).toBe(INVALID_QUERY);
      expect(mail.sent).toEqual([]);
    });
  });

  const hiddenDocuments = {
    'an unknown document': async () => ({ id: 'missingDoc1' }),
    'a document of another user': async () => seedDocument(await createCaller('contracts_Admin')),
    'an archived own document': async () => seedDocument(owner, { IsArchive: true }),
    'a declined own document': async () => seedDocument(owner, { IsDeclined: true }),
  };
  Object.entries(hiddenDocuments).forEach(([label, seed]) => {
    it(`reports ${label} as not found without sending mail`, async () => {
      const doc = await seed();

      const failure = await captureRejection(
        forward({ docId: doc.id, recipients: [RECIPIENT] }, owner.account)
      );

      expect(failure.code).toBe(OBJECT_NOT_FOUND);
      expect(mail.sent).toEqual([]);
    });
  });

  it('mails every recipient with the sender details stored on the document', async () => {
    const doc = await seedDocument(owner, {
      Name: 'Lease',
      SenderName: 'Custom Sender',
      SenderMail: 'sender@example.com',
      SignedUrl: fileUrl('signed.pdf'),
    });

    const result = await forward(
      { docId: doc.id, recipients: [RECIPIENT, SECOND_RECIPIENT] },
      owner.account
    );

    expect(result).toEqual({ status: 'success' });
    expect(mail.sent.map(message => message.to)).toEqual([RECIPIENT, SECOND_RECIPIENT]);
    expect(mail.last().subject).toBe('Custom Sender has signed the doc - Lease');
    expect(mail.last().html).toContain('please contact the sender sender@example.com directly');
  });

  it('falls back to the sender profile when the document stores no sender details', async () => {
    const doc = await seedDocument(owner, { Name: 'Lease' });

    await forward({ docId: doc.id, recipients: [RECIPIENT] }, owner.account);

    expect(mail.last().subject).toBe('Fixture User has signed the doc - Lease');
    expect(mail.last().html).toContain(`contact the sender ${owner.account.email} directly`);
  });

  describe('sender details', () => {
    const withoutLoginEmail = async () => {
      const user = await new Parse.Query(Parse.User).get(owner.account.id, MASTER);
      user.unset('email');
      await user.save(null, MASTER);
    };

    it('omits missing sender details instead of printing undefined', async () => {
      const doc = await seedDocument(owner, { ExtUserPtr: undefined });

      await forward({ docId: doc.id, recipients: [RECIPIENT] }, owner.account);

      expect(mail.last().subject).not.toContain('undefined');
      expect(mail.last().html).not.toContain('undefined');
    });

    it('falls back to the login email as reply address when there is no profile', async () => {
      const doc = await seedDocument(owner, { ExtUserPtr: undefined });

      await forward({ docId: doc.id, recipients: [RECIPIENT] }, owner.account);

      expect(mail.last().html).toContain(`contact the sender ${owner.account.email} directly`);
    });

    const invalidReplyAddresses = {
      'a line break': 'sender@example.com\r\nBcc: victim@example.com',
      'a malformed value': 'not-an-address',
      'an angle bracket wrapper': 'Boss <boss@example.com>',
    };
    Object.entries(invalidReplyAddresses).forEach(([label, senderMail]) => {
      it(`drops the contact sentence when the stored sender mail has ${label}`, async () => {
        const doc = await seedDocument(owner, { SenderMail: senderMail });

        await forward({ docId: doc.id, recipients: [RECIPIENT] }, owner.account);

        expect(mail.last().html).not.toContain('please contact the sender');
      });
    });

    it('drops the contact sentence when no reply address is known', async () => {
      await withoutLoginEmail();
      const doc = await seedDocument(owner, { ExtUserPtr: undefined });

      await forward({ docId: doc.id, recipients: [RECIPIENT] }, owner.account);

      expect(mail.last().html).not.toContain('please contact the sender');
      expect(mail.last().html).not.toContain('undefined');
      expect(mail.last().subject).not.toContain('undefined');
    });
  });

  it('reports a rejected provider delivery as an error status', async () => {
    mail.providerStatus = 500;
    const doc = await seedDocument(owner);

    const result = await forward({ docId: doc.id, recipients: [RECIPIENT] }, owner.account);

    expect(result).toEqual({ status: 'error' });
  });

  const mailFailures = {
    'the provider error field': { response: { data: { error: 'provider said no' } } },
    'the raw provider body': { response: { data: 'raw failure' } },
    'a provider body naming internal resources': {
      response: { data: { error: 'bucket internal-name' } },
    },
    'a provider body that is an object': { response: { data: { bucket: 'internal-name' } } },
    'the error message': new Error('disk failure'),
    'an empty failure': {},
  };
  Object.entries(mailFailures).forEach(([label, failure]) => {
    it(`turns a failing mail step into a generic bad request despite ${label}`, async () => {
      failCertificateCleanupWith(failure);
      const doc = await seedDocument(owner, { SignedUrl: fileUrl('signed.pdf') });

      const error = await captureRejection(
        forward({ docId: doc.id, recipients: [RECIPIENT] }, owner.account)
      );

      expect(error.code).toBe(MAIL_FAILURE);
      expect(error.message).toBe(GENERIC_MAIL_FAILURE);
    });
  });

  it('logs the full mail failure server side', async () => {
    const failure = { response: { data: { error: 'bucket internal-name' } } };
    failCertificateCleanupWith(failure);
    const doc = await seedDocument(owner, { SignedUrl: fileUrl('signed.pdf') });

    await captureRejection(forward({ docId: doc.id, recipients: [RECIPIENT] }, owner.account));

    expect(console.log).toHaveBeenCalledWith(jasmine.any(String), failure);
  });

  describe('mail content', () => {
    it('escapes the document name inside the forwarded mail', async () => {
      const injected = '<a href="https://evil.test/login">Verify account</a>';
      const doc = await seedDocument(owner, { Name: injected });

      await forward({ docId: doc.id, recipients: [RECIPIENT] }, owner.account);

      expect(mail.last().html).not.toContain(injected);
      expect(mail.last().html).toContain(escapeHtml(injected));
    });

    it('escapes the sender name and reply address inside the forwarded mail', async () => {
      const doc = await seedDocument(owner, {
        SenderName: '<b>Boss</b>',
        SenderMail: '"><script>x</script>@evil.test',
      });

      await forward({ docId: doc.id, recipients: [RECIPIENT] }, owner.account);

      expect(mail.last().html).not.toContain('<script>');
      expect(mail.last().html).not.toContain('<b>Boss</b>');
    });

    it('keeps line breaks out of the subject', async () => {
      const doc = await seedDocument(owner, { Name: 'Lease\r\nBcc: victim@example.com' });

      await forward({ docId: doc.id, recipients: [RECIPIENT] }, owner.account);

      expect(mail.last().subject).not.toMatch(/[\r\n]/);
    });
  });

  describe('recipients validation', () => {
    const rejectedRecipients = {
      'a string instead of a list': 'me@x.io',
      'an object instead of a list': { 0: RECIPIENT, length: 1 },
      'a non string entry': [RECIPIENT, 42],
      'a null entry': [null],
      'a blank entry': ['   '],
      'a malformed address': ['not-an-email'],
      'several comma separated addresses in one entry': [`${RECIPIENT},${SECOND_RECIPIENT}`],
      'a semicolon separated pair in one entry': [`${RECIPIENT};${SECOND_RECIPIENT}`],
      'a space separated pair in one entry': [`${RECIPIENT} ${SECOND_RECIPIENT}`],
      'a comma inside the local part': ['a,b@example.com'],
      'an angle bracket display name': ['Foo<a@b.com>'],
      'a quoted local part': ['"a"@b.com'],
      'parentheses in the local part': ['a(b)@c.com'],
      'a backslash in the local part': ['a\\b@c.com'],
      'a null character in the local part': ['a\u0000b@c.com'],
      'an inner carriage return': ['a\r@b.com'],
      'a line separator': ['a\u2028b@c.com'],
      'a paragraph separator': ['a\u2029b@c.com'],
      'a delete character': ['a\u007fb@c.com'],
      'an apostrophe': ["a'b@c.com"],
      'a comma separated list of eleven addresses': [recipientsOf(11).join(',')],
      'eleven distinct addresses': recipientsOf(11),
    };
    Object.entries(rejectedRecipients).forEach(([label, recipients]) => {
      it(`rejects ${label} without sending mail`, async () => {
        const doc = await seedDocument(owner);

        const failure = await captureRejection(
          forward({ docId: doc.id, recipients }, owner.account)
        );

        expect(failure.code).toBe(INVALID_QUERY);
        expect(mail.sent).toEqual([]);
      });
    });

    it('rejects an oversized recipient list before querying the document', async () => {
      const doc = await seedDocument(owner);
      const lookup = spyOn(Parse.Query.prototype, 'first').and.callThrough();

      const failure = await captureRejection(
        forward({ docId: doc.id, recipients: recipientsOf(10000) }, owner.account)
      );

      expect(failure.code).toBe(INVALID_QUERY);
      expect(lookup).not.toHaveBeenCalled();
      expect(mail.sent).toEqual([]);
    });

    it('rejects more entries than the accepted cap even when they collapse to one address', async () => {
      const doc = await seedDocument(owner);

      const failure = await captureRejection(
        forward(
          { docId: doc.id, recipients: Array(MAX_ACCEPTED_ENTRIES + 1).fill(RECIPIENT) },
          owner.account
        )
      );

      expect(failure.code).toBe(INVALID_QUERY);
      expect(mail.sent).toEqual([]);
    });

    it('validates the recipients before looking the document up', async () => {
      const failure = await captureRejection(
        forward({ docId: 'missingDoc1', recipients: 'me@x.io' }, owner.account)
      );

      expect(failure.code).toBe(INVALID_QUERY);
    });

    it('trims and deduplicates addresses ignoring case', async () => {
      const doc = await seedDocument(owner);

      const result = await forward(
        {
          docId: doc.id,
          recipients: [`  ${RECIPIENT.toUpperCase()} `, RECIPIENT, SECOND_RECIPIENT],
        },
        owner.account
      );

      expect(result).toEqual({ status: 'success' });
      expect(mail.sent.map(message => message.to.toLowerCase())).toEqual([
        RECIPIENT,
        SECOND_RECIPIENT,
      ]);
    });

    it('accepts eleven entries that collapse to ten addresses', async () => {
      const doc = await seedDocument(owner);

      const result = await forward(
        { docId: doc.id, recipients: [...recipientsOf(10), 'R0@example.com'] },
        owner.account
      );

      expect(result).toEqual({ status: 'success' });
      expect(mail.sent.length).toBe(10);
    });
  });

  describe('delivery report', () => {
    it('reports success only when every recipient was delivered', async () => {
      const doc = await seedDocument(owner);

      const result = await forward(
        { docId: doc.id, recipients: [RECIPIENT, SECOND_RECIPIENT] },
        owner.account
      );

      expect(result).toEqual({ status: 'success' });
    });

    it('reports an error status when every delivery is rejected', async () => {
      mail.providerStatus = PROVIDER_ERROR;
      const doc = await seedDocument(owner);

      const result = await forward(
        { docId: doc.id, recipients: [RECIPIENT, SECOND_RECIPIENT] },
        owner.account
      );

      expect(result).toEqual({ status: 'error' });
      expect(mail.sent.length).toBe(2);
    });

    it('reports a failed delivery to an earlier recipient as a partial result', async () => {
      failFirstCommsDelivery(mail);
      const doc = await seedDocument(owner);

      const result = await forward(
        { docId: doc.id, recipients: [RECIPIENT, SECOND_RECIPIENT] },
        owner.account
      );

      expect(mail.sent.length).toBe(2);
      expect(result).toEqual({
        status: 'partial',
        sentCount: 1,
        failedCount: 1,
        failedRecipients: [RECIPIENT],
      });
    });

    it('reports a partial result when one recipient throws and another is delivered', async () => {
      failCertificateCleanupOnce(new Error('disk failure'));
      const doc = await seedDocument(owner, { SignedUrl: fileUrl('signed.pdf') });

      const result = await forward(
        { docId: doc.id, recipients: [RECIPIENT, SECOND_RECIPIENT] },
        owner.account
      );

      expect(result).toEqual({
        status: 'partial',
        sentCount: 1,
        failedCount: 1,
        failedRecipients: [RECIPIENT],
      });
    });

    it('keeps attempting later recipients after an earlier one throws', async () => {
      failCertificateCleanupOnce(new Error('disk failure'));
      const doc = await seedDocument(owner, { SignedUrl: fileUrl('signed.pdf') });

      await forward({ docId: doc.id, recipients: [RECIPIENT, SECOND_RECIPIENT] }, owner.account);

      expect(mail.sent.map(message => message.to)).toEqual([RECIPIENT, SECOND_RECIPIENT]);
    });
  });
});
