import {
  findNextSigner,
  notifyNextSigner,
  resolveSigningBaseUrl,
} from './nextSignerNotification.js';

const PUBLIC_URL = 'https://app.test';
const decodeLink = link => Buffer.from(link.split('/login/')[1], 'base64').toString('utf8');

const buildPlaceholder = (id, email, extra = {}) => ({
  Role: `Signer ${id}`,
  signerObjId: id,
  signerPtr: { objectId: id },
  email,
  ...extra,
});

const buildDocument = (overrides = {}) => ({
  objectId: 'doc1',
  Name: 'Contract',
  Note: 'please',
  createdAt: '2026-01-01T00:00:00.000Z',
  SendinOrder: true,
  Placeholders: [
    { Role: 'prefill', email: '' },
    buildPlaceholder('c1', 'first@x.com'),
    buildPlaceholder('v1', 'viewer@x.com', { SignerRole: 'viewer' }),
    buildPlaceholder('c2', 'second@x.com'),
    buildPlaceholder('c3', 'third@x.com'),
  ],
  Signers: [
    { objectId: 'c1', Email: 'first@x.com', Name: 'First' },
    { objectId: 'v1', Email: 'viewer@x.com', Name: 'Viewer' },
    { objectId: 'c2', Email: 'second@x.com', Name: 'Second', Phone: '555' },
    { objectId: 'c3', Email: 'third@x.com', Name: 'Third' },
  ],
  ExtUserPtr: { objectId: 'ext1', Name: 'Owner', Email: 'owner@x.com', Company: 'Acme' },
  ...overrides,
});

const signedBy = ids => ids.map(id => ({ UserPtr: { objectId: id }, Activity: 'Signed' }));

const baseInput = (overrides = {}) => ({
  document: buildDocument(),
  signerObjectId: 'c1',
  auditTrail: signedBy(['c1']),
  isCompleted: false,
  sendNextMail: true,
  publicUrl: PUBLIC_URL,
  ...overrides,
});

describe('nextSignerNotification', () => {
  let saved;
  let fetchSpy;

  const sentBodies = () => fetchSpy.calls.allArgs().map(args => JSON.parse(args[1].body));

  beforeEach(() => {
    saved = {
      COMMS_BASE_URL: process.env.COMMS_BASE_URL,
      COMMS_API_KEY: process.env.COMMS_API_KEY,
      PUBLIC_URL: process.env.PUBLIC_URL,
      NODE_ENV: process.env.NODE_ENV,
    };
    process.env.COMMS_BASE_URL = 'https://comms.test';
    process.env.COMMS_API_KEY = 'test-key';
    spyOn(console, 'log');
    fetchSpy = spyOn(globalThis, 'fetch').and.resolveTo({ status: 201 });
  });

  afterEach(() => {
    Object.entries(saved).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  });

  describe('findNextSigner', () => {
    it('skips prefill and viewer placeholders', () => {
      const next = findNextSigner(buildDocument(), 'c1', signedBy(['c1']));

      expect(next.signerObjId).toBe('c2');
    });

    it('skips signers that already signed out of order', () => {
      const next = findNextSigner(buildDocument(), 'c1', signedBy(['c1', 'c2']));

      expect(next.signerObjId).toBe('c3');
    });

    it('returns undefined for the last signer', () => {
      expect(findNextSigner(buildDocument(), 'c3', signedBy(['c3']))).toBeUndefined();
    });

    it('returns undefined when the current signer is not a placeholder', () => {
      expect(findNextSigner(buildDocument(), 'owner', [])).toBeUndefined();
      expect(findNextSigner(buildDocument(), undefined, [])).toBeUndefined();
    });

    it('tolerates a document without placeholders', () => {
      expect(findNextSigner({}, 'c1', [])).toBeUndefined();
    });
  });

  describe('resolveSigningBaseUrl', () => {
    it('prefers the configured PUBLIC_URL over request headers', () => {
      process.env.PUBLIC_URL = 'https://configured.test/';

      expect(resolveSigningBaseUrl({ public_url: 'https://evil.test' })).toBe(
        'https://configured.test'
      );
    });

    it('falls back to the server derived public_url header', () => {
      delete process.env.PUBLIC_URL;

      expect(resolveSigningBaseUrl({ public_url: 'https://host.test' })).toBe('https://host.test');
    });

    it('ignores a client supplied origin header', () => {
      delete process.env.PUBLIC_URL;

      expect(resolveSigningBaseUrl({ origin: 'https://evil.test' })).toBe('');
    });

    it('returns an empty string when nothing is configured', () => {
      delete process.env.PUBLIC_URL;

      expect(resolveSigningBaseUrl(undefined)).toBe('');
    });

    describe('in production', () => {
      beforeEach(() => {
        process.env.NODE_ENV = 'production';
      });

      it('uses only the validated PUBLIC_URL origin even if the header differs', () => {
        process.env.PUBLIC_URL = 'https://configured.test/some/path/';

        expect(resolveSigningBaseUrl({ public_url: 'https://evil.test' })).toBe(
          'https://configured.test'
        );
      });

      it('returns nothing when PUBLIC_URL is missing, ignoring the header', () => {
        delete process.env.PUBLIC_URL;

        expect(resolveSigningBaseUrl({ public_url: 'https://evil.test' })).toBe('');
      });

      ['http://configured.test', 'not a url', 'https://user:pass@configured.test'].forEach(
        value => {
          it(`rejects PUBLIC_URL "${value}" ignoring the header`, () => {
            process.env.PUBLIC_URL = value;

            expect(resolveSigningBaseUrl({ public_url: 'https://evil.test' })).toBe('');
          });
        }
      );
    });

    describe('outside production', () => {
      it('still falls back to the header', () => {
        process.env.NODE_ENV = 'development';
        delete process.env.PUBLIC_URL;

        expect(resolveSigningBaseUrl({ public_url: 'https://host.test' })).toBe(
          'https://host.test'
        );
      });
    });
  });

  describe('notifyNextSigner', () => {
    it('emails only the next signer with a link carrying doc, email and contact id', async () => {
      await notifyNextSigner(baseInput());

      const bodies = sentBodies();
      expect(bodies.length).toBe(1);
      expect(bodies[0].to).toBe('second@x.com');
      const link = bodies[0].html.match(/https:\/\/app\.test\/login\/[A-Za-z0-9+/=]+/)[0];
      expect(decodeLink(link)).toBe('doc1/second@x.com/c2');
    });

    it('uses the document request template before the tenant template', async () => {
      const document = buildDocument({
        RequestSubject: 'Doc subject for {{receiver_name}}',
        RequestBody: '<p>Doc body {{document_title}} {{signing_url}}</p>',
      });
      document.ExtUserPtr.TenantId = {
        RequestSubject: 'Tenant subject',
        RequestBody: '<p>Tenant body</p>',
      };

      await notifyNextSigner(baseInput({ document }));

      const [body] = sentBodies();
      expect(body.subject).toBe('Doc subject for Second');
      expect(body.html).toContain('Doc body Contract https://app.test/login/');
    });

    it('uses the tenant template when the document has none', async () => {
      const document = buildDocument();
      document.ExtUserPtr.TenantId = {
        RequestSubject: 'Tenant subject {{receiver_email}}',
        RequestBody: '<p>Tenant body</p>',
      };

      await notifyNextSigner(baseInput({ document }));

      const [body] = sentBodies();
      expect(body.subject).toBe('Tenant subject second@x.com');
      expect(body.html).toContain('Tenant body');
    });

    it('uses the default template when neither document nor tenant define one', async () => {
      await notifyNextSigner(baseInput());

      const [body] = sentBodies();
      expect(body.subject).toBe('Owner has requested you to sign "Contract"');
      expect(body.html).toContain('Digital Signature Request');
    });

    it('does not need any session or user to deliver', async () => {
      await expectAsync(notifyNextSigner(baseInput())).toBeResolved();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    const suppressedCases = [
      ['the document is completed by this signature', { isCompleted: true }],
      ['sendNextMail is false', { sendNextMail: false }],
      ['sending is disabled on the document', { document: buildDocument({ IsSendMail: false }) }],
      ['the document is not sequential', { document: buildDocument({ SendinOrder: false }) }],
      ['there is no next signer', { signerObjectId: 'c3', auditTrail: signedBy(['c3']) }],
      ['no public url is available', { publicUrl: '' }],
    ];

    suppressedCases.forEach(([name, overrides]) => {
      it(`sends nothing when ${name}`, async () => {
        await notifyNextSigner(baseInput(overrides));

        expect(fetchSpy).not.toHaveBeenCalled();
      });
    });

    it('logs the fixed skip message once and sends nothing when no public url is configured', async () => {
      await notifyNextSigner(baseInput({ publicUrl: '' }));

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(console.log.calls.allArgs()).toEqual([
        ['next signer notification skipped: PUBLIC_URL not configured'],
      ]);
    });

    it('does not log the skip message when there is no next signer', async () => {
      await notifyNextSigner(
        baseInput({ publicUrl: '', signerObjectId: 'c3', auditTrail: signedBy(['c3']) })
      );

      expect(console.log).not.toHaveBeenCalled();
    });

    it('sends nothing and logs a fixed message when the next recipient email is blank', async () => {
      const document = buildDocument();
      document.Placeholders[3] = buildPlaceholder('c2', '   ');
      document.Signers = document.Signers.filter(signer => signer.objectId !== 'c2');

      await notifyNextSigner(baseInput({ document }));

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(console.log.calls.allArgs()).toEqual([
        ['next signer notification skipped: no recipient'],
      ]);
    });

    it('resolves and logs a fixed message when the mail sender throws', async () => {
      const deliver = jasmine.createSpy('deliver').and.rejectWith(new Error('boom second@x.com'));

      await expectAsync(notifyNextSigner(baseInput({ deliver }))).toBeResolved();

      expect(deliver).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(console.log.calls.allArgs());
      expect(logged).toContain('next signer notification failed');
      expect(logged).not.toContain('second@x.com');
    });

    it('logs a fixed message when the sender reports an error status', async () => {
      const deliver = jasmine.createSpy('deliver').and.resolveTo({ status: 'error' });

      await notifyNextSigner(baseInput({ deliver }));

      expect(JSON.stringify(console.log.calls.allArgs())).toContain(
        'next signer notification failed'
      );
    });
  });
});
