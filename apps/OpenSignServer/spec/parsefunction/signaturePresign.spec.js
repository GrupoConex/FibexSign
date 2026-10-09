import jwt from 'jsonwebtoken';
import getPresignedUrl, {
  getSignedUrl,
  presignedlocalUrl,
} from '../../cloud/parsefunction/getSignedUrl.js';
import SignatureAfterFind from '../../cloud/parsefunction/SignatureAfterFind.js';
import { resetUntrustedHostReportsForTesting } from '../../cloud/parsefunction/shared/storageUrlPolicy.js';
import { knownDefect } from '../utils/known-defect.js';
import {
  captureRejection,
  createPlainUser,
  purgeCreatedAccounts,
  silenceConsole,
} from '../utils/auth-fixtures.js';

const INVALID_SESSION_TOKEN = 209;

const STORAGE_ENV = {
  DO_SPACE: 'vault',
  DO_ENDPOINT: 'ams3.digitaloceanspaces.com',
  DO_BASEURL: 'https://cdn.firma.example',
  DO_REGION: 'ams3',
  DO_ACCESS_KEY_ID: 'key',
  DO_SECRET_ACCESS_KEY: 'secret',
  STORAGE_LEGACY_HOSTS: '',
};
const SIGNED_MARKER = /X-Amz-Signature|token=/;
const FOREIGN_BUCKET_URL = 'https://attacker.example/private-contract-key.pdf';
const FOREIGN_LOCAL_URL = 'https://attacker.example/files/test/private-contract.pdf';

const withEnv = overrides => {
  const saved = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  return () =>
    Object.entries(saved).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
};

const signatureRow = fields => {
  const row = new Parse.Object('contracts_Signature');
  Object.entries(fields).forEach(([key, value]) => row.set(key, value));
  return row;
};

const isLocalMode = () => process.env.USE_LOCAL?.toLowerCase() === 'true';

describe('signature url presigning', () => {
  let restoreEnv;

  beforeEach(() => {
    silenceConsole();
    restoreEnv = withEnv(STORAGE_ENV);
  });

  afterEach(async () => {
    restoreEnv();
    await purgeCreatedAccounts();
  });

  describe('getPresignedUrl', () => {
    it('presigns the object of the configured bucket', async () => {
      const url = await getPresignedUrl('https://cdn.firma.example/owner_sign.png');

      expect(url).toContain('X-Amz-Signature');
      expect(url).toContain('/owner_sign.png');
    });

    it('does not presign a key addressed through a foreign host', async () => {
      const url = await getPresignedUrl(FOREIGN_BUCKET_URL);

      expect(url).toBe(FOREIGN_BUCKET_URL);
    });

    it('does not sign a foreign url that mimics a local file path', async () => {
      const url = await getPresignedUrl(FOREIGN_LOCAL_URL);

      expect(url).toBe(FOREIGN_LOCAL_URL);
    });

    it('does not presign a malformed url', async () => {
      const url = await getPresignedUrl('not a url');

      expect(url).toBe('not a url');
    });

    it('keeps signing local files served by this server', async () => {
      const own = `${process.env.SERVER_URL}/files/test/own.png`;

      expect(presignedlocalUrl(own)).toContain('token=');
      expect(await getPresignedUrl(own)).toContain('token=');
    });

    it('does not sign a local file path on a foreign host', () => {
      expect(presignedlocalUrl(FOREIGN_LOCAL_URL)).toBe(FOREIGN_LOCAL_URL);
    });
  });

  describe('SignatureAfterFind chain', () => {
    const resolve = async fields => {
      const [result] = await SignatureAfterFind({ objects: [signatureRow(fields)] });
      return result;
    };

    it('never turns a manipulated ImageURL into a signed url', async () => {
      const result = await resolve({ ImageURL: FOREIGN_BUCKET_URL });

      expect(result.get('ImageURL')).not.toMatch(SIGNED_MARKER);
    });

    it('never turns a manipulated local style ImageURL into a signed url', async () => {
      const result = await resolve({ ImageURL: FOREIGN_LOCAL_URL });

      expect(result.get('ImageURL')).not.toMatch(SIGNED_MARKER);
    });

    it('protects Initials and Stamp as well', async () => {
      const result = await resolve({ Initials: FOREIGN_BUCKET_URL, Stamp: FOREIGN_LOCAL_URL });

      expect(result.get('Initials')).not.toMatch(SIGNED_MARKER);
      expect(result.get('Stamp')).not.toMatch(SIGNED_MARKER);
    });

    it('still signs the legitimate signature images of the owner', async () => {
      const stored = isLocalMode()
        ? `${process.env.SERVER_URL}/files/test`
        : STORAGE_ENV.DO_BASEURL;

      const result = await resolve({ ImageURL: `${stored}/own_sign.png` });

      expect(result.get('ImageURL')).toMatch(SIGNED_MARKER);
    });
  });

  describe('legacy hosts and logging', () => {
    it('presigns bucket urls served by a configured legacy host', async () => {
      process.env.STORAGE_LEGACY_HOSTS = 'old-cdn.example';

      const url = await getPresignedUrl('https://old-cdn.example/legacy_sign.png');

      expect(url).toContain('X-Amz-Signature');
    });

    it('logs an untrusted host once without its path', async () => {
      resetUntrustedHostReportsForTesting();
      const warn = spyOn(console, 'warn');

      await getPresignedUrl('https://unknown-one.example/private/key.pdf?sig=1');
      await getPresignedUrl('https://unknown-one.example/private/other.pdf');

      expect(warn).toHaveBeenCalledTimes(1);
      const message = warn.calls.mostRecent().args.join(' ');
      expect(message).toContain('unknown-one.example');
      expect(message).not.toContain('private');
    });

    it('signs the origin and path of a validated local file only', () => {
      const own = `${process.env.SERVER_URL}/files/test/own.png`;

      const signed = presignedlocalUrl(`${own}?x=1#fragment`);

      const token = new URL(signed).searchParams.get('token');
      expect(jwt.decode(token).fileUrl).toBe(own);
      expect(signed.startsWith(`${own}?token=`)).toBeTrue();
    });
  });

  describe('getsignedurl cloud function', () => {
    const OWN_FILE = () => `${process.env.SERVER_URL}/files/test/other.pdf`;

    const seedRow = async (className, fields) => {
      const row = new Parse.Object(className);
      Object.entries(fields).forEach(([key, value]) => row.set(key, value));
      return row.save(null, { useMasterKey: true });
    };

    const sessionUser = async () => {
      const account = await createPlainUser();
      return new Parse.Query(Parse.User).get(account.id, { useMasterKey: true });
    };

    it('does not presign a foreign host url for a signed in caller', async () => {
      const user = await sessionUser();

      const result = await getSignedUrl({ params: { url: FOREIGN_BUCKET_URL }, user });

      expect(result).not.toMatch(SIGNED_MARKER);
    });

    it('signs nothing when the document does not exist', async () => {
      const result = await getSignedUrl({ params: { docId: 'missingDocument', url: OWN_FILE() } });

      expect(result).not.toMatch(SIGNED_MARKER);
    });

    it('signs nothing when the template does not exist', async () => {
      const result = await getSignedUrl({
        params: { templateId: 'missingTemplate', url: OWN_FILE() },
      });

      expect(result).not.toMatch(SIGNED_MARKER);
    });

    it('signs nothing for an archived document', async () => {
      const doc = await seedRow('contracts_Document', { IsArchive: true });

      const result = await getSignedUrl({ params: { docId: doc.id, url: OWN_FILE() } });

      expect(result).not.toMatch(SIGNED_MARKER);
    });

    it('refuses an otp protected document without a session', async () => {
      const doc = await seedRow('contracts_Document', { IsEnableOTP: true });

      const failure = await captureRejection(
        getSignedUrl({ params: { docId: doc.id, url: OWN_FILE() } })
      );

      expect(failure.code).toBe(INVALID_SESSION_TOKEN);
    });

    it('refuses an otp protected template without a session', async () => {
      const template = await seedRow('contracts_Template', { IsEnableOTP: true });

      const failure = await captureRejection(
        getSignedUrl({ params: { templateId: template.id, url: OWN_FILE() } })
      );

      expect(failure.code).toBe(INVALID_SESSION_TOKEN);
    });

    it('signs a file of an otp protected document for a signed in caller', async () => {
      const doc = await seedRow('contracts_Document', { IsEnableOTP: true });
      const user = await sessionUser();

      const result = await getSignedUrl({ params: { docId: doc.id, url: OWN_FILE() }, user });

      expect(result).toMatch(SIGNED_MARKER);
    });

    it('signs a file of a guest document without otp and without session', async () => {
      const doc = await seedRow('contracts_Document', { IsEnableOTP: false });

      const result = await getSignedUrl({ params: { docId: doc.id, url: OWN_FILE() } });

      expect(result).toMatch(SIGNED_MARKER);
    });

    it('signs a file of a public template without otp and without session', async () => {
      const template = await seedRow('contracts_Template', { IsEnableOTP: false });

      const result = await getSignedUrl({ params: { templateId: template.id, url: OWN_FILE() } });

      expect(result).toMatch(SIGNED_MARKER);
    });

    it('does not sign a foreign host url even for an existing document', async () => {
      const doc = await seedRow('contracts_Document', { IsEnableOTP: false });

      const result = await getSignedUrl({ params: { docId: doc.id, url: FOREIGN_LOCAL_URL } });

      expect(result).not.toMatch(SIGNED_MARKER);
    });

    it('requires a session when no document is named', async () => {
      const failure = await captureRejection(getSignedUrl({ params: { url: OWN_FILE() } }));

      expect(failure.code).toBe(INVALID_SESSION_TOKEN);
    });

    it(
      'documents that an existing document signs any trusted file url unrelated to its content',
      knownDefect(
        'DEF-SIG-01',
        'getsignedurl with an existing docId signs any trusted storage url without tying it to that document',
        async check => {
          const doc = await seedRow('contracts_Document', { IsEnableOTP: false });

          const result = await getSignedUrl({ params: { docId: doc.id, url: OWN_FILE() } });

          check(!SIGNED_MARKER.test(result), 'url unrelated to the document must not be signed');
        }
      )
    );
  });
});
