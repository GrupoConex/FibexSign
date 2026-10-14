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

const MASTER = { useMasterKey: true };
const OBJECT_NOT_FOUND = 101;
const SESSION_LOOKUP_TIMEOUT_MS = 5000;
const timedOutLookup = () =>
  Promise.reject(Object.assign(new Error('timeout of 5000ms exceeded'), { code: 'ECONNABORTED' }));

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

  describe('include parameter', () => {
    let doc;
    let contact;

    beforeEach(async () => {
      contact = await seedContact(owner, await createPlainUser());
      doc = await seedDocument(owner, { Bcc: [pointer('contracts_Contactbook', contact.id)] });
    });

    it('resolves the extra relation named by include for the owner session', async () => {
      routeSessionLookupWithJavascriptKey();

      const plain = await getDocument({ docId: doc.id });
      const included = await getDocument(
        { docId: doc.id, include: 'Bcc' },
        owner.account.sessionToken
      );

      expect(plain.Bcc[0].Email).toBeUndefined();
      expect(included.Bcc[0].Email).toBe(contact.get('Email'));
    });

    it('resolves Cc and Bcc from a comma separated include with spaces', async () => {
      routeSessionLookupWithJavascriptKey();
      const cc = await seedContact(owner, await createPlainUser());
      await doc.save({ Cc: [pointer('contracts_Contactbook', cc.id)] }, MASTER);

      const included = await getDocument(
        { docId: doc.id, include: ' Bcc , Cc ' },
        owner.account.sessionToken
      );

      expect(included.Bcc[0].Email).toBe(contact.get('Email'));
      expect(included.Cc[0].Email).toBe(cc.get('Email'));
    });

    it('ignores include for an anonymous caller', async () => {
      const result = await getDocument({ docId: doc.id, include: 'Bcc' });

      expect(result.objectId).toBe(doc.id);
      expect(result.Bcc[0].Email).toBeUndefined();
    });

    it('ignores include for a session that does not own the document', async () => {
      routeSessionLookupWithJavascriptKey();
      const intruder = await createCaller('contracts_Admin');

      const result = await getDocument(
        { docId: doc.id, include: 'Bcc' },
        intruder.account.sessionToken
      );

      expect(result.objectId).toBe(doc.id);
      expect(result.Bcc[0].Email).toBeUndefined();
    });

    it('ignores include for an invalid session token', async () => {
      routeSessionLookupWithJavascriptKey();

      const result = await getDocument({ docId: doc.id, include: 'Bcc' }, 'r:invalid');

      expect(result.objectId).toBe(doc.id);
      expect(result.Bcc[0].Email).toBeUndefined();
    });

    it('ignores paths outside the whitelist even for the owner', async () => {
      routeSessionLookupWithJavascriptKey();
      await doc.save({ Signers: [pointer('contracts_Contactbook', contact.id)] }, MASTER);

      const result = await getDocument(
        { docId: doc.id, include: 'ExtUserPtr.UserId,Signers.UserId' },
        owner.account.sessionToken
      );

      expect(result.Signers[0].UserId).toEqual(pointer('_User', contact.get('UserId').objectId));
      expect(result.ExtUserPtr.UserId).toEqual(pointer('_User', owner.account.id));
    });

    it('bounds the session lookup with a timeout', async () => {
      const lookup = routeSessionLookupWithJavascriptKey();

      await getDocument({ docId: doc.id, include: 'Bcc' }, owner.account.sessionToken);

      const [, config] = lookup.calls.mostRecent().args;
      expect(config.timeout).toBe(SESSION_LOOKUP_TIMEOUT_MS);
    });

    it('ignores include when the session lookup times out', async () => {
      answerSessionLookupWith(timedOutLookup);

      const result = await getDocument(
        { docId: doc.id, include: 'Bcc' },
        owner.account.sessionToken
      );

      expect(result.objectId).toBe(doc.id);
      expect(result.Bcc[0].Email).toBeUndefined();
    });

    it('does not resolve the session when no allowed include is requested', async () => {
      const lookup = answerSessionLookupWith(async () => {
        throw new Error('session lookup must not run');
      });

      const result = await getDocument(
        { docId: doc.id, include: 'Signers.UserId' },
        owner.account.sessionToken
      );

      expect(lookup).not.toHaveBeenCalled();
      expect(result.objectId).toBe(doc.id);
    });
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

    it('refuses when the session lookup times out', async () => {
      answerSessionLookupWith(timedOutLookup);
      const doc = await withAcl(await seedDocument(owner, { IsEnableOTP: true }), [
        owner.account.id,
      ]);

      const result = await getDocument({ docId: doc.id }, owner.account.sessionToken);

      expect(result).toEqual({ error: NO_DOCUMENT_ACCESS });
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

  it('reports a failing document lookup through the error envelope', async () => {
    rejectFirstFor('contracts_Document', new Parse.Error(OBJECT_NOT_FOUND, 'lookup failed'));

    const result = await getDocument({ docId: 'anyDocument' });

    expect(result).toEqual({ error: NO_DOCUMENT_ACCESS });
  });

  describe('projection of the sender internal records', () => {
    const POINTER_KEYS = ['__type', 'className', 'objectId'];
    const PROFILE_KEYS = [
      ...POINTER_KEYS,
      'Name',
      'Email',
      'Phone',
      'Company',
      'JobTitle',
      'UseNameAsSender',
      'SignatureType',
      'DateFormat',
      'WidgetPreferences',
      'HeaderDocId',
      'DownloadFilenameFormat',
      'UserId',
      'TenantId',
    ];

    const projectionOf = async (fields = {}) => {
      await owner.extUser.save(
        { Company: 'Acme', JobTitle: 'CEO', HeaderDocId: 'header1' },
        MASTER
      );
      const doc = await seedDocument(owner, fields);
      return getDocument({ docId: doc.id });
    };

    it('reduces the sender login to a pointer', async () => {
      const result = await projectionOf();

      expect(result.CreatedBy).toEqual(pointer('_User', owner.account.id));
    });

    it('keeps only the whitelisted sender profile fields', async () => {
      const result = await projectionOf();

      expect(Object.keys(result.ExtUserPtr).filter(key => !PROFILE_KEYS.includes(key))).toEqual([]);
      expect(result.ExtUserPtr.objectId).toBe(owner.extUser.id);
      expect(result.ExtUserPtr.Company).toBe('Acme');
      expect(result.ExtUserPtr.JobTitle).toBe('CEO');
      expect(result.ExtUserPtr.UserRole).toBeUndefined();
      expect(result.ExtUserPtr.TeamIds).toBeUndefined();
    });

    it('reduces the login and tenant of the sender profile to pointers', async () => {
      const result = await projectionOf();

      const { UserId, TenantId } = result.ExtUserPtr;
      expect(Object.keys(UserId).sort()).toEqual(POINTER_KEYS.slice().sort());
      expect(UserId.objectId).toBe(owner.account.id);
      expect(Object.keys(TenantId).sort()).toEqual(POINTER_KEYS.slice().sort());
      expect(TenantId.objectId).toBe(owner.tenant.id);
    });

    it('never creates a sender profile when the document has none', async () => {
      const result = await projectionOf({ ExtUserPtr: undefined });

      expect('ExtUserPtr' in result).toBeFalse();
    });

    it('keeps only the id and email of the decline author', async () => {
      const decliner = await createPlainUser();

      const result = await projectionOf({ DeclineBy: pointer('_User', decliner.id) });

      expect(Object.keys(result.DeclineBy).sort()).toEqual(
        ['__type', 'className', 'email', 'objectId'].sort()
      );
      expect(result.DeclineBy.objectId).toBe(decliner.id);
      expect(result.DeclineBy.email).toBe(decliner.email);
    });

    it('keeps only the public fields of each audit trail user and the rest of the entry', async () => {
      const signer = await seedContact(owner, await createPlainUser());

      const result = await projectionOf({
        AuditTrail: [{ UserPtr: pointer('contracts_Contactbook', signer.id), Activity: 'Signed' }],
      });

      const [entry] = result.AuditTrail;
      expect(entry.Activity).toBe('Signed');
      expect(Object.keys(entry.UserPtr).sort()).toEqual(
        ['Email', 'Name', '__type', 'className', 'objectId'].sort()
      );
      expect(entry.UserPtr.Email).toBe(signer.get('Email'));
    });

    it('leaves the signers untouched', async () => {
      const signer = await seedContact(owner, await createPlainUser());

      const result = await projectionOf({ Signers: [pointer('contracts_Contactbook', signer.id)] });

      expect(result.Signers[0].Email).toBe(signer.get('Email'));
      expect(result.Signers[0].CreatedBy.objectId).toBe(owner.account.id);
    });
  });

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
