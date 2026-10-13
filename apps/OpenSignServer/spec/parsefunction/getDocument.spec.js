import {
  createCaller,
  createPlainUser,
  pointer,
  purgeCreatedAccounts,
  rejectFirstFor,
  silenceConsole,
} from '../utils/auth-fixtures.js';
import {
  DOCUMENT_GONE,
  NO_DOCUMENT_ACCESS,
  answerSessionLookupWith,
  readWriteFor,
  routeSessionLookupWithJavascriptKey,
  runFunctionOverRest,
  seedContact,
  seedDocument,
} from '../utils/document-fixtures.js';
import { knownDefect } from '../utils/known-defect.js';

const MASTER = { useMasterKey: true };
const OBJECT_NOT_FOUND = 101;

const getDocument = async (params, sessionToken) => {
  const body = await runFunctionOverRest(
    'getDocument',
    params,
    sessionToken ? { sessiontoken: sessionToken } : {}
  );
  return body.result;
};

const withAcl = (row, userIds) => {
  row.setACL(new Parse.ACL(readWriteFor(...userIds)));
  return row.save(null, MASTER);
};

const storeTenantSecrets = tenant =>
  tenant.save({ FileAdapters: 'sensitive-adapter-config', PfxFile: { name: 'cert.pfx' } }, MASTER);

describe('getDocument', () => {
  let owner;

  beforeEach(async () => {
    silenceConsole();
    owner = await createCaller('contracts_Admin');
  });

  afterEach(async () => {
    await purgeCreatedAccounts();
  });

  it('asks for the required parameters when no document id is sent', async () => {
    expect(await getDocument({})).toEqual({ error: 'Please pass required parameters!' });
  });

  it('reports an unknown document as deleted or inaccessible', async () => {
    expect(await getDocument({ docId: 'missingDoc1' })).toEqual({ error: DOCUMENT_GONE });
  });

  it('reports an archived document as deleted or inaccessible', async () => {
    const doc = await seedDocument(owner, { IsArchive: true });

    expect(await getDocument({ docId: doc.id })).toEqual({ error: DOCUMENT_GONE });
  });

  it('returns a document without otp with the tenant secrets removed', async () => {
    await storeTenantSecrets(owner.tenant);
    const doc = await seedDocument(owner);

    const result = await getDocument({ docId: doc.id });

    expect(result.objectId).toBe(doc.id);
    expect(result.ExtUserPtr.TenantId.objectId).toBe(owner.tenant.id);
    expect(result.ExtUserPtr.TenantId.FileAdapters).toBeUndefined();
    expect(result.ExtUserPtr.TenantId.PfxFile).toBeUndefined();
  });

  it('resolves the extra relation named by include', async () => {
    const contact = await seedContact(owner, await createPlainUser());
    const doc = await seedDocument(owner, { Bcc: [pointer('contracts_Contactbook', contact.id)] });

    const plain = await getDocument({ docId: doc.id });
    const included = await getDocument({ docId: doc.id, include: 'Bcc' });

    expect(plain.Bcc[0].Email).toBeUndefined();
    expect(included.Bcc[0].Email).toBe(contact.get('Email'));
  });

  describe('with otp enabled', () => {
    it('refuses a caller without a session token header', async () => {
      const doc = await withAcl(await seedDocument(owner, { IsEnableOTP: true }), [
        owner.account.id,
      ]);

      expect(await getDocument({ docId: doc.id })).toEqual({ error: NO_DOCUMENT_ACCESS });
    });

    it('returns the document to a session listed in its ACL', async () => {
      routeSessionLookupWithJavascriptKey();
      const doc = await withAcl(await seedDocument(owner, { IsEnableOTP: true }), [
        owner.account.id,
      ]);

      const result = await getDocument({ docId: doc.id }, owner.account.sessionToken);

      expect(result.objectId).toBe(doc.id);
    });

    it('refuses a session of another user that is not in the ACL', async () => {
      routeSessionLookupWithJavascriptKey();
      const intruder = await createPlainUser();
      const doc = await withAcl(await seedDocument(owner, { IsEnableOTP: true }), [
        owner.account.id,
      ]);

      const result = await getDocument({ docId: doc.id }, intruder.sessionToken);

      expect(result).toEqual({ error: NO_DOCUMENT_ACCESS });
    });

    it('refuses even the owner when the document carries no ACL', async () => {
      routeSessionLookupWithJavascriptKey();
      const doc = await seedDocument(owner, { IsEnableOTP: true });

      const result = await getDocument({ docId: doc.id }, owner.account.sessionToken);

      expect(result).toEqual({ error: NO_DOCUMENT_ACCESS });
    });

    it('refuses an invalid session token', async () => {
      routeSessionLookupWithJavascriptKey();
      const doc = await withAcl(await seedDocument(owner, { IsEnableOTP: true }), [
        owner.account.id,
      ]);

      expect(await getDocument({ docId: doc.id }, 'r:invalid')).toEqual({
        error: NO_DOCUMENT_ACCESS,
      });
    });

    it('refuses when the session lookup answers without a user', async () => {
      answerSessionLookupWith(async () => ({ data: null }));
      const doc = await withAcl(await seedDocument(owner, { IsEnableOTP: true }), [
        owner.account.id,
      ]);

      const result = await getDocument({ docId: doc.id }, owner.account.sessionToken);

      expect(result).toEqual({ error: NO_DOCUMENT_ACCESS });
    });
  });

  it(
    'KNOWN DEFECT DEF-L3-11 reports a failing document lookup through the error envelope',
    knownDefect(
      'DEF-L3-11',
      'getDocument and getTemplate inner catch returns the raw error object as a successful result instead of the {error} envelope or a rejection',
      async check => {
        rejectFirstFor('contracts_Document', new Parse.Error(OBJECT_NOT_FOUND, 'lookup failed'));

        const result = await getDocument({ docId: 'anyDocument' });

        check(result?.objectId === undefined, 'no document is returned');
        check(result?.code === undefined, 'no raw error code leaks as a result');
        check(result === undefined || typeof result.error === 'string', 'error envelope used');
      }
    )
  );

  it(
    'KNOWN DEFECT DEF-L3-03 hides the sender internal records from an anonymous caller',
    knownDefect(
      'DEF-L3-03',
      'getDocument returns the sender _User login, contracts_Users profile and tenant row of any non OTP document to anonymous callers',
      async check => {
        const doc = await seedDocument(owner);

        const result = await getDocument({ docId: doc.id });

        check(result.CreatedBy?.username === undefined, 'sender login username hidden');
        check(result.CreatedBy?.email === undefined, 'sender login email hidden');
        check(result.ExtUserPtr?.UserRole === undefined, 'sender role hidden');
        check(result.ExtUserPtr?.TeamIds === undefined, 'sender teams hidden');
      }
    )
  );

  it('returns a document whose sender profile is missing or has no tenant', async () => {
    const doc = await seedDocument(owner, { ExtUserPtr: undefined });
    const orphan = await seedDocument(owner);
    await owner.extUser.save({ TenantId: null }, MASTER);

    const withoutProfile = await getDocument({ docId: doc.id });
    const withoutTenant = await getDocument({ docId: orphan.id });

    expect(withoutProfile.objectId).toBe(doc.id);
    expect(withoutTenant.objectId).toBe(orphan.id);
  });
});
