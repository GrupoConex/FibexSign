import axios from 'axios';
import { sendMail } from '../../cloud/parsefunction/createBatchDocs.js';
import { resetCommsMailBreaker } from '../../cloud/parsefunction/shared/commsMailClient.js';

const COMMS_KEYS = ['COMMS_BASE_URL', 'COMMS_API_KEY'];

const buildDocument = () => ({
  objectId: 'doc1',
  Name: 'Contract',
  createdAt: '2026-01-01T00:00:00.000Z',
  Placeholders: [{ email: 'Signer@x.com', Role: 'signer' }],
  Signers: [],
  ExtUserPtr: { objectId: 'ext1', Name: 'Owner', Email: 'owner@x.com' },
});

describe('createBatchDocs signing request mail', () => {
  let saved;
  let fetchSpy;
  let postSpy;

  beforeEach(() => {
    resetCommsMailBreaker();
    saved = Object.fromEntries(COMMS_KEYS.map(key => [key, process.env[key]]));
    process.env.COMMS_BASE_URL = 'https://comms.test';
    process.env.COMMS_API_KEY = 'test-key';
    spyOn(console, 'log');
    fetchSpy = spyOn(globalThis, 'fetch').and.resolveTo({ status: 201 });
    postSpy = spyOn(axios, 'post').and.resolveTo({ data: {} });
  });

  afterEach(() => {
    COMMS_KEYS.forEach(key => {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    });
  });

  it('delivers in process without any HTTP request to the sendmailv3 endpoint', async () => {
    await sendMail(buildDocument(), 'https://app.test');

    const postedUrls = postSpy.calls.allArgs().map(args => String(args[0]));
    expect(postedUrls.some(url => url.includes('sendmailv3'))).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchSpy.calls.first().args[1].body).to).toBe('signer@x.com');
  });

  it('invites only the first signer and viewers when sending in order', async () => {
    const document = {
      ...buildDocument(),
      SendinOrder: true,
      Placeholders: [
        { email: 'prefill@x.com', Role: 'prefill' },
        { email: 'viewer@x.com', Role: 'Viewer', SignerRole: 'viewer' },
        { email: 'first@x.com', Role: 'Signer 1' },
        { email: 'second@x.com', Role: 'Signer 2' },
      ],
    };

    await sendMail(document, 'https://app.test');

    const recipients = fetchSpy.calls.allArgs().map(args => JSON.parse(args[1].body).to);
    expect(recipients).toEqual(['viewer@x.com', 'first@x.com']);
  });

  it('builds the invitation from the tenant request template', async () => {
    const document = buildDocument();
    document.ExtUserPtr.TenantId = {
      RequestSubject: 'Hello {{receiver_email}}',
      RequestBody: '<p>Sign {{document_title}}</p>',
    };

    await sendMail(document, 'https://app.test');

    const body = JSON.parse(fetchSpy.calls.first().args[1].body);
    expect(body.subject).toBe('Hello Signer@x.com');
    expect(body.html).toContain('<p>Sign Contract</p>');
  });

  it('keeps going and logs when a delivery fails', async () => {
    fetchSpy.and.resolveTo({ status: 502 });

    await expectAsync(sendMail(buildDocument(), 'https://app.test')).toBeResolved();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
