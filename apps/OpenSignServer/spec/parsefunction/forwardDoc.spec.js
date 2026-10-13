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
import { knownDefect } from '../utils/known-defect.js';

const INVALID_SESSION_TOKEN = 209;
const INVALID_QUERY = 102;
const OBJECT_NOT_FOUND = 101;
const MAIL_FAILURE = 400;
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

  it(
    'KNOWN DEFECT DEF-L3-07 omits missing sender details instead of printing undefined',
    knownDefect(
      'DEF-L3-07',
      'forwarddoc writes "undefined" as sender name and reply address when the document has no sender profile',
      async check => {
        const doc = await seedDocument(owner, { ExtUserPtr: undefined });

        await forward({ docId: doc.id, recipients: [RECIPIENT] }, owner.account);

        check(!mail.last().subject.includes('undefined'), 'subject has no undefined sender');
        check(!mail.last().html.includes('undefined'), 'body has no undefined reply address');
      }
    )
  );

  it('reports a rejected provider delivery as an error status', async () => {
    mail.providerStatus = 500;
    const doc = await seedDocument(owner);

    const result = await forward({ docId: doc.id, recipients: [RECIPIENT] }, owner.account);

    expect(result).toEqual({ status: 'error' });
  });

  const mailFailures = {
    'the provider error field': [
      { response: { data: { error: 'provider said no' } } },
      'provider said no',
    ],
    'the raw provider body': [{ response: { data: 'raw failure' } }, 'raw failure'],
    'the error message': [new Error('disk failure'), 'disk failure'],
    'a generic message': [{}, 'Something went wrong.'],
  };
  Object.entries(mailFailures).forEach(([label, [failure, message]]) => {
    it(`turns a failing mail step into a bad request with ${label}`, async () => {
      failCertificateCleanupWith(failure);
      const doc = await seedDocument(owner, { SignedUrl: fileUrl('signed.pdf') });

      const error = await captureRejection(
        forward({ docId: doc.id, recipients: [RECIPIENT] }, owner.account)
      );

      expect(error.code).toBe(MAIL_FAILURE);
      expect(error.message).toBe(message);
    });
  });

  it(
    'KNOWN DEFECT DEF-L3-05 escapes the document name inside the forwarded mail',
    knownDefect(
      'DEF-L3-05',
      'forwarddoc interpolates the document Name unescaped into the mail HTML sent to arbitrary recipients',
      async check => {
        const injected = '<a href="https://evil.test/login">Verify account</a>';
        const doc = await seedDocument(owner, { Name: injected });

        await forward({ docId: doc.id, recipients: [RECIPIENT] }, owner.account);

        check(!mail.last().html.includes(injected), 'markup from the name is not rendered');
      }
    )
  );

  it(
    'KNOWN DEFECT DEF-L3-06 keeps the ten recipient cap for comma separated addresses',
    knownDefect(
      'DEF-L3-06',
      'forwarddoc caps the recipients array at ten but each entry may hold several comma separated addresses',
      async check => {
        const doc = await seedDocument(owner);

        await forward({ docId: doc.id, recipients: [recipientsOf(11).join(',')] }, owner.account);

        check(mail.sent.length <= 10, 'at most ten addresses are mailed');
      }
    )
  );

  it(
    'KNOWN DEFECT DEF-L3-12 reports a failed delivery to an earlier recipient',
    knownDefect(
      'DEF-L3-12',
      'forwarddoc overwrites mailRes per recipient and returns only the last result, so earlier delivery failures are lost',
      async check => {
        failFirstCommsDelivery(mail);
        const doc = await seedDocument(owner);

        const outcome = await forward(
          { docId: doc.id, recipients: [RECIPIENT, SECOND_RECIPIENT] },
          owner.account
        ).catch(error => ({ rejected: error }));

        check(mail.sent.length === 2, 'both recipients were attempted');
        check(outcome?.status !== 'success', 'a partial failure is not reported as success');
      }
    )
  );

  it(
    'KNOWN DEFECT DEF-L3-13 treats a recipients string as one address instead of characters',
    knownDefect(
      'DEF-L3-13',
      'forwarddoc accepts a non array recipients string and mails each of its characters as a separate recipient',
      async check => {
        const doc = await seedDocument(owner);

        await captureRejection(forward({ docId: doc.id, recipients: 'me@x.io' }, owner.account));

        check(
          mail.sent.every(message => message.to.includes('@')),
          'no single character recipient is mailed'
        );
      }
    )
  );
});
