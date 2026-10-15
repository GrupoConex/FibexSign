import { inspect } from 'node:util';
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
  failSessionLookupThenRoute,
  fileUrl,
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

const axiosFailure = (token, { status, code } = {}) =>
  Object.assign(new Error('lookup failed'), {
    code,
    config: { headers: { 'X-Parse-Session-Token': token } },
    ...(status ? { response: { status } } : {}),
  });

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

      expect(plain.Bcc).toBeUndefined();
      expect(included.Bcc[0].Email).toBe(contact.get('Email'));
    });

    it('projects the included Bcc contacts to the public fields plus the phone', async () => {
      routeSessionLookupWithJavascriptKey();
      await contact.save(
        { Phone: '+5800000000', TenantId: pointer('partners_Tenant', owner.tenant.id) },
        MASTER
      );

      const included = await getDocument(
        { docId: doc.id, include: 'Bcc' },
        owner.account.sessionToken
      );

      expect(Object.keys(included.Bcc[0]).sort()).toEqual(
        ['Email', 'Name', 'Phone', '__type', 'className', 'objectId'].sort()
      );
      expect(included.Bcc[0].Phone).toBe('+5800000000');
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
      expect(result.Bcc).toBeUndefined();
    });

    it('ignores include for a session that does not own the document', async () => {
      routeSessionLookupWithJavascriptKey();
      const intruder = await createCaller('contracts_Admin');

      const result = await getDocument(
        { docId: doc.id, include: 'Bcc' },
        intruder.account.sessionToken
      );

      expect(result.objectId).toBe(doc.id);
      expect(result.Bcc).toBeUndefined();
    });

    it('ignores include for an invalid session token', async () => {
      routeSessionLookupWithJavascriptKey();

      const result = await getDocument({ docId: doc.id, include: 'Bcc' }, 'r:invalid');

      expect(result.objectId).toBe(doc.id);
      expect(result.Bcc).toBeUndefined();
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
      expect(result.Bcc).toBeUndefined();
    });

    it('never logs the session token when the session lookup fails', async () => {
      const token = owner.account.sessionToken;
      const failure = axiosFailure(token, { status: 401 });
      answerSessionLookupWith(() => Promise.reject(failure));

      await getDocument({ docId: doc.id, include: 'Bcc' }, token);

      const logged = inspect(console.log.calls.allArgs(), { depth: 8 });
      expect(console.log.calls.count()).toBeGreaterThan(0);
      expect(logged).not.toContain(token);
      expect(logged).toContain('401');
    });

    it('logs the error code when the failed lookup has no response', async () => {
      const token = owner.account.sessionToken;
      answerSessionLookupWith(() => Promise.reject(axiosFailure(token, { code: 'ECONNRESET' })));

      await getDocument({ docId: doc.id, include: 'Bcc' }, token);

      const logged = inspect(console.log.calls.allArgs(), { depth: 8 });
      expect(logged).not.toContain(token);
      expect(logged).toContain('ECONNRESET');
    });

    it('retries the session lookup once after a transient failure and serves the owner view', async () => {
      const token = owner.account.sessionToken;
      const lookup = failSessionLookupThenRoute([axiosFailure(token, { status: 503 })]);

      const result = await getDocument({ docId: doc.id, include: 'Bcc' }, token);

      expect(lookup).toHaveBeenCalledTimes(2);
      expect(result.Bcc[0].Email).toBe(contact.get('Email'));
    });

    it('retries after a network error without a response', async () => {
      const token = owner.account.sessionToken;
      const lookup = failSessionLookupThenRoute([axiosFailure(token, { code: 'ECONNRESET' })]);

      const result = await getDocument({ docId: doc.id, include: 'Bcc' }, token);

      expect(lookup).toHaveBeenCalledTimes(2);
      expect(result.Bcc[0].Email).toBe(contact.get('Email'));
    });

    it('does not retry when the session is rejected with a client error', async () => {
      const token = owner.account.sessionToken;
      const lookup = failSessionLookupThenRoute([axiosFailure(token, { status: 401 })]);

      const result = await getDocument({ docId: doc.id, include: 'Bcc' }, token);

      expect(lookup).toHaveBeenCalledTimes(1);
      expect(result.Bcc).toBeUndefined();
    });

    it('gives up after two transient failures and serves the non owner view', async () => {
      const token = owner.account.sessionToken;
      const lookup = failSessionLookupThenRoute([
        axiosFailure(token, { status: 502 }),
        axiosFailure(token, { code: 'ECONNABORTED' }),
      ]);

      const result = await getDocument({ docId: doc.id, include: 'Bcc' }, token);

      expect(lookup).toHaveBeenCalledTimes(2);
      expect(result.objectId).toBe(doc.id);
      expect(result.Bcc).toBeUndefined();
    });

    const failingLookup = () =>
      answerSessionLookupWith(async () => {
        throw new Error('session lookup must not run');
      });

    it('does not resolve the session for a caller without a session token', async () => {
      const lookup = failingLookup();

      const result = await getDocument({ docId: doc.id, include: 'Bcc' });

      expect(lookup).not.toHaveBeenCalled();
      expect(result.objectId).toBe(doc.id);
    });

    it('does not resolve the session for a token that is not a session token', async () => {
      const lookup = failingLookup();

      await getDocument({ docId: doc.id }, 'null');
      await getDocument({ docId: doc.id }, 'not-a-session');

      expect(lookup).not.toHaveBeenCalled();
    });

    it('resolves the session of a session token even when no include is requested', async () => {
      const lookup = routeSessionLookupWithJavascriptKey();

      const result = await getDocument({ docId: doc.id }, owner.account.sessionToken);

      expect(lookup).toHaveBeenCalledTimes(1);
      expect(result.objectId).toBe(doc.id);
    });

    it('resolves the session only once when otp is enabled', async () => {
      const lookup = routeSessionLookupWithJavascriptKey();
      const otpDoc = await withAcl(await seedDocument(owner, { IsEnableOTP: true }), [
        owner.account.id,
      ]);

      await getDocument({ docId: otpDoc.id, include: 'Bcc' }, owner.account.sessionToken);

      expect(lookup).toHaveBeenCalledTimes(1);
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
        AuditTrail: [
          {
            UserPtr: pointer('contracts_Contactbook', signer.id),
            Activity: 'Signed',
            ipAddress: '10.0.0.1',
            Signature: 'data:image/png;base64,AAAA',
            SignedUrl: fileUrl('signed.pdf'),
            SignedOn: 'Jan 1, 2030',
            ViewedOn: 'Jan 1, 2030',
          },
        ],
      });

      const [entry] = result.AuditTrail;
      expect(Object.keys(entry).sort()).toEqual(['Activity', 'UserPtr']);
      expect(entry.Activity).toBe('Signed');
      expect(Object.keys(entry.UserPtr).sort()).toEqual(
        ['Email', 'Name', '__type', 'className', 'objectId'].sort()
      );
      expect(entry.UserPtr.Email).toBe(signer.get('Email'));
    });

    it('reduces each signer to the public contact fields', async () => {
      const signer = await seedContact(owner, await createPlainUser(), {
        Phone: '+5800000000',
        TenantId: pointer('partners_Tenant', owner.tenant.id),
        UserRole: 'contracts_Guest',
        IsDeleted: false,
        JobTitle: 'CTO',
        Company: 'Acme',
        TourStatus: [{ requestSign: true }],
      });
      await withAcl(signer, [owner.account.id]);

      const result = await projectionOf({ Signers: [pointer('contracts_Contactbook', signer.id)] });

      const [projected] = result.Signers;
      expect(projected.Email).toBe(signer.get('Email'));
      expect(projected.JobTitle).toBe('CTO');
      expect(projected.Company).toBe('Acme');
      ['ACL', 'CreatedBy', 'TenantId', 'UserRole', 'IsDeleted', 'Phone', 'TourStatus'].forEach(
        key => expect(projected[key]).toBeUndefined()
      );
      expect(projected.UserId).toEqual(pointer('_User', signer.get('UserId').objectId));
    });

    it('keeps the signer phone for the owner only', async () => {
      routeSessionLookupWithJavascriptKey();
      const signer = await seedContact(owner, await createPlainUser(), { Phone: '+5800000000' });
      const doc = await seedDocument(owner, {
        Signers: [pointer('contracts_Contactbook', signer.id)],
      });

      const asAnonymous = await getDocument({ docId: doc.id });
      const asOwner = await getDocument({ docId: doc.id }, owner.account.sessionToken);
      const intruder = await createCaller('contracts_Admin');
      const asIntruder = await getDocument({ docId: doc.id }, intruder.account.sessionToken);

      expect(asAnonymous.Signers[0].Phone).toBeUndefined();
      expect(asIntruder.Signers[0].Phone).toBeUndefined();
      expect(asOwner.Signers[0].Phone).toBe('+5800000000');
    });

    it('keeps the signer login pointer that the anonymous signing page reads', async () => {
      const signerAccount = await createPlainUser();
      const signer = await seedContact(owner, signerAccount);

      const result = await projectionOf({ Signers: [pointer('contracts_Contactbook', signer.id)] });

      expect(result.Signers[0].UserId.objectId).toBe(signerAccount.id);
    });

    it('drops the internal top level fields for every caller', async () => {
      routeSessionLookupWithJavascriptKey();
      const doc = await withAcl(
        await seedDocument(owner, {
          OriginIp: '10.0.0.1',
          DebugginLog: 'trace',
          FileAdapterId: 'adapter1',
        }),
        [owner.account.id]
      );

      const asAnonymous = await getDocument({ docId: doc.id });
      const asOwner = await getDocument({ docId: doc.id }, owner.account.sessionToken);

      [asAnonymous, asOwner].forEach(result =>
        ['ACL', 'OriginIp', 'DebugginLog', 'FileAdapterId'].forEach(key =>
          expect(result[key]).toBeUndefined()
        )
      );
    });

    describe('owner only fields', () => {
      const OWNER_ONLY = {
        RequestBody: 'body',
        RequestSubject: 'subject',
        EmailEditorType: 'html',
        NextReminderDate: { __type: 'Date', iso: '2030-01-01T00:00:00.000Z' },
        TemplateId: pointer('contracts_Template', 'tpl1'),
        Bcc: [],
        Cc: [],
      };

      it('hides them from anonymous callers and sessions that do not own the document', async () => {
        routeSessionLookupWithJavascriptKey();
        const doc = await seedDocument(owner, OWNER_ONLY);
        const intruder = await createCaller('contracts_Admin');

        const asAnonymous = await getDocument({ docId: doc.id });
        const asIntruder = await getDocument({ docId: doc.id }, intruder.account.sessionToken);

        [asAnonymous, asIntruder].forEach(result =>
          Object.keys(OWNER_ONLY).forEach(key => expect(result[key]).toBeUndefined())
        );
      });

      it('keeps them for the owner', async () => {
        routeSessionLookupWithJavascriptKey();
        const doc = await seedDocument(owner, OWNER_ONLY);

        const result = await getDocument({ docId: doc.id }, owner.account.sessionToken);

        expect(result.RequestBody).toBe('body');
        expect(result.RequestSubject).toBe('subject');
        expect(result.EmailEditorType).toBe('html');
        expect(result.TemplateId.objectId).toBe('tpl1');
        expect(result.NextReminderDate.iso).toBe('2030-01-01T00:00:00.000Z');
        expect(result.Bcc).toEqual([]);
        expect(result.Cc).toEqual([]);
      });
    });

    describe('placeholders', () => {
      const placeholdersOf = signerPtr => [
        {
          Id: 1,
          Role: 'signer',
          signerObjId: 'c1',
          signerPtr,
          placeHolder: [{ pageNumber: 1, pos: [{ xPosition: 1, options: { name: 'sig' } }] }],
        },
      ];

      it('passes them through unchanged when the signer pointer is not embedded', async () => {
        const stored = placeholdersOf(pointer('contracts_Contactbook', 'c1'));

        const result = await projectionOf({ Placeholders: stored });

        expect(JSON.stringify(result.Placeholders)).toBe(JSON.stringify(stored));
      });

      it('reduces a legacy embedded signer record to a pointer', async () => {
        const embedded = {
          className: 'contracts_Contactbook',
          objectId: 'c1',
          Name: 'Ana',
          Email: 'ana@example.com',
          Phone: '+5800000000',
          ACL: { '*': { read: true } },
        };
        const stored = placeholdersOf(embedded);

        const result = await projectionOf({ Placeholders: stored });

        expect(result.Placeholders).toEqual(placeholdersOf(pointer('contracts_Contactbook', 'c1')));
      });

      it('replaces a signer record without an id by an empty object', async () => {
        const stored = placeholdersOf({ Name: 'Ana', Email: 'ana@example.com' });

        const result = await projectionOf({ Placeholders: stored });

        expect(result.Placeholders).toEqual(placeholdersOf({}));
      });

      it('keeps an empty signer pointer as stored', async () => {
        const stored = placeholdersOf({});

        const result = await projectionOf({ Placeholders: stored });

        expect(result.Placeholders).toEqual(stored);
      });
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
