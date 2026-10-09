import sendmailv3, { deliverMailv3 } from '../../cloud/parsefunction/sendMailv3.js';
import {
  CommsLane,
  resetCommsMailBreaker,
} from '../../cloud/parsefunction/shared/commsMailClient.js';
import { resetSendMailv3UserLimits } from '../../cloud/parsefunction/shared/sendMailv3Authorization.js';
import {
  cloudRunAs,
  createExtUser,
  createOrganization,
  createPlainUser,
  createTeam,
  createTenant,
  createTenantMember,
  createTenantScope,
  pointer,
  resetRateLimits,
  uniqueEmail,
} from '../utils/auth-fixtures.js';

const COMMS_KEYS = [
  'COMMS_BASE_URL',
  'COMMS_API_KEY',
  'SENDMAILV3_USER_LIMIT',
  'SENDMAILV3_USER_WINDOW_MS',
];
const MASTER = { useMasterKey: true };
const OPERATION_FORBIDDEN = 119;
const REQUEST_LIMIT_EXCEEDED = 155;

const captureRejection = async promise => {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  return undefined;
};

const saveObject = async (className, values) => {
  const object = new Parse.Object(className);
  await object.save(values, MASTER);
  return object;
};

const loadUser = id => new Parse.Query(Parse.User).get(id, MASTER);

const createOwnerFixture = async () => {
  const account = await createPlainUser(uniqueEmail('mail-owner'));
  const extUser = await createExtUser({ account, role: 'contracts_Admin' });
  const signer = await saveObject('contracts_Contactbook', {
    Name: 'Signer',
    Email: uniqueEmail('mail-signer'),
  });
  const placeholderEmail = uniqueEmail('mail-placeholder');
  const document = await saveObject('contracts_Document', {
    Name: 'Contract',
    CreatedBy: pointer('_User', account.id),
    ExtUserPtr: pointer('contracts_Users', extUser.id),
    Signers: [signer.toPointer()],
    Placeholders: [{ Role: 'Signer 1', email: placeholderEmail }],
  });
  return { account, extUser, signer, document, placeholderEmail };
};

const readEmailCount = async extUser => {
  const fresh = await new Parse.Query('contracts_Users').get(extUser.id, MASTER);
  return fresh.get('EmailCount') ?? 0;
};

const createExtUserAccount = async ({ role, tenant, organization, team }) => {
  const account = await createPlainUser(uniqueEmail('scoped'));
  const extUser = await createExtUser({ account, role, tenant, organization, team });
  return { account, extUser };
};

describe('sendmailv3 authorization', () => {
  let saved;
  let fetchSpy;
  let owner;
  let ownerUser;

  const paramsFor = (overrides = {}) => ({
    docId: owner.document.id,
    recipient: owner.signer.get('Email'),
    subject: 'S',
    html: '<p>h</p>',
    from: 'Sender',
    ...overrides,
  });

  const callAsOwner = (overrides, user = ownerUser) =>
    sendmailv3({ params: paramsFor(overrides), user });

  beforeAll(async () => {
    owner = await createOwnerFixture();
    ownerUser = await loadUser(owner.account.id);
  });

  beforeEach(() => {
    resetCommsMailBreaker();
    resetSendMailv3UserLimits();
    saved = Object.fromEntries(COMMS_KEYS.map(key => [key, process.env[key]]));
    process.env.COMMS_BASE_URL = 'https://comms.test';
    process.env.COMMS_API_KEY = 'test-key';
    spyOn(console, 'log');
    fetchSpy = spyOn(globalThis, 'fetch').and.resolveTo({ status: 201 });
  });

  afterEach(() => {
    COMMS_KEYS.forEach(key => {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    });
    resetSendMailv3UserLimits();
  });

  describe('sessions', () => {
    it('rejects callers without a session using INVALID_SESSION_TOKEN and sends nothing', async () => {
      const thrown = await captureRejection(sendmailv3({ params: paramsFor() }));

      expect(thrown).toEqual(jasmine.any(Parse.Error));
      expect(thrown.code).toBe(Parse.Error.INVALID_SESSION_TOKEN);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('rejects callers explicitly flagged as non master without a user', async () => {
      const thrown = await captureRejection(sendmailv3({ params: paramsFor(), master: false }));

      expect(thrown.code).toBe(Parse.Error.INVALID_SESSION_TOKEN);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('answers 209 through the registered cloud function when no session is sent', async () => {
      Parse.User.logOut();

      const thrown = await captureRejection(Parse.Cloud.run('sendmailv3', paramsFor()));

      expect(thrown.code).toBe(Parse.Error.INVALID_SESSION_TOKEN);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('sends through the registered cloud function for the document owner session', async () => {
      await resetRateLimits();

      const result = await cloudRunAs('sendmailv3', paramsFor(), owner.account.sessionToken);

      expect(result).toEqual({ status: 'success' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('document requirement', () => {
    it('rejects a missing docId and sends nothing', async () => {
      const thrown = await captureRejection(callAsOwner({ docId: undefined }));

      expect(thrown).toEqual(jasmine.any(Parse.Error));
      expect(thrown.code).toBe(Parse.Error.INVALID_QUERY);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('forbids a document that does not exist', async () => {
      const thrown = await captureRejection(callAsOwner({ docId: 'missingDocId' }));

      expect(thrown.code).toBe(OPERATION_FORBIDDEN);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('ownership', () => {
    it('sends for the creator of the document', async () => {
      const result = await callAsOwner({});

      expect(result).toEqual({ status: 'success' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('sends for the user behind the document ext user when CreatedBy differs', async () => {
      const other = await createPlainUser(uniqueEmail('mail-creator'));
      const document = await saveObject('contracts_Document', {
        Name: 'Linked',
        CreatedBy: pointer('_User', other.id),
        ExtUserPtr: pointer('contracts_Users', owner.extUser.id),
        Signers: [owner.signer.toPointer()],
      });

      const result = await callAsOwner({ docId: document.id });

      expect(result).toEqual({ status: 'success' });
    });

    it('forbids an unrelated authenticated user and sends nothing', async () => {
      const stranger = await createPlainUser(uniqueEmail('mail-stranger'));

      const thrown = await captureRejection(callAsOwner({}, await loadUser(stranger.id)));

      expect(thrown.code).toBe(OPERATION_FORBIDDEN);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('shared access', () => {
    let scope;
    let documentOwner;
    let sharedDocument;

    const setAncestors = async (team, ancestors) => {
      team.set(
        'Ancestors',
        ancestors.map(ancestor => ancestor.toPointer())
      );
      return team.save(null, MASTER);
    };

    const createSharedDocument = overrides =>
      saveObject('contracts_Document', {
        Name: 'Shared',
        CreatedBy: pointer('_User', documentOwner.account.id),
        ExtUserPtr: pointer('contracts_Users', documentOwner.extUser.id),
        Signers: [owner.signer.toPointer()],
        ...overrides,
      });

    const sendAs = async (account, document) =>
      sendmailv3({
        params: paramsFor({ docId: document.id }),
        user: await loadUser(account.id),
      });

    beforeAll(async () => {
      scope = await createTenantScope();
      await setAncestors(scope.team, [scope.team]);
      documentOwner = await createTenantMember('contracts_User', scope, 'doc-owner');
      sharedDocument = await createSharedDocument({ SharedWith: [scope.team.toPointer()] });
    });

    it('allows a member of a team the document is shared with', async () => {
      const member = await createTenantMember('contracts_User', scope, 'team-member');

      const result = await sendAs(member.account, sharedDocument);

      expect(result).toEqual({ status: 'success' });
    });

    it('allows a member of a child team when the document is shared with the parent', async () => {
      const child = await createTeam(scope.organization, 'Child');
      await setAncestors(child, [scope.team, child]);
      const member = await createExtUserAccount({ role: 'contracts_User', team: child });

      const result = await sendAs(member.account, sharedDocument);

      expect(result).toEqual({ status: 'success' });
    });

    it('allows a user listed in SharedWithUsers even without teams', async () => {
      const account = await createPlainUser(uniqueEmail('shared-user'));
      const extUser = await createExtUser({ account, role: 'contracts_User' });
      const document = await createSharedDocument({
        SharedWithUsers: [pointer('contracts_Users', extUser.id)],
      });

      const result = await sendAs(account, document);

      expect(result).toEqual({ status: 'success' });
    });

    it('allows a contracts_Admin of the document tenant', async () => {
      const admin = await createTenantMember('contracts_Admin', scope, 'tenant-admin');
      const document = await createSharedDocument({});

      expect(await sendAs(admin.account, document)).toEqual({ status: 'success' });
    });

    it('allows a contracts_OrgAdmin of the document organization', async () => {
      const orgAdmin = await createTenantMember('contracts_OrgAdmin', scope, 'org-admin');
      const document = await createSharedDocument({});

      expect(await sendAs(orgAdmin.account, document)).toEqual({ status: 'success' });
    });

    it('forbids a contracts_OrgAdmin of another organization in the same tenant', async () => {
      const otherOrganization = await createOrganization(scope.tenant, 'Other Org');
      const orgAdmin = await createExtUserAccount({
        role: 'contracts_OrgAdmin',
        tenant: scope.tenant,
        organization: otherOrganization,
      });
      const document = await createSharedDocument({});

      const thrown = await captureRejection(sendAs(orgAdmin.account, document));

      expect(thrown.code).toBe(OPERATION_FORBIDDEN);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('forbids a contracts_Admin of another tenant', async () => {
      const otherTenant = await createTenant('Other Tenant');
      const admin = await createExtUserAccount({ role: 'contracts_Admin', tenant: otherTenant });
      const document = await createSharedDocument({});

      const thrown = await captureRejection(sendAs(admin.account, document));

      expect(thrown.code).toBe(OPERATION_FORBIDDEN);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('forbids a team member when the document is not shared with the team', async () => {
      const member = await createTenantMember('contracts_User', scope, 'plain-member');
      const document = await createSharedDocument({});

      const thrown = await captureRejection(sendAs(member.account, document));

      expect(thrown.code).toBe(OPERATION_FORBIDDEN);
    });

    it('forbids a disabled admin of the document tenant', async () => {
      const admin = await createTenantMember('contracts_Admin', scope, 'disabled-admin');
      admin.extUser.set('IsDisabled', true);
      await admin.extUser.save(null, MASTER);
      const document = await createSharedDocument({});

      const thrown = await captureRejection(sendAs(admin.account, document));

      expect(thrown.code).toBe(OPERATION_FORBIDDEN);
    });

    it('still blocks foreign recipients for authorized members', async () => {
      const admin = await createTenantMember('contracts_Admin', scope, 'admin-recipient');

      const thrown = await captureRejection(
        sendmailv3({
          params: paramsFor({ docId: sharedDocument.id, recipient: 'attacker@evil.test' }),
          user: await loadUser(admin.account.id),
        })
      );

      expect(thrown.code).toBe(OPERATION_FORBIDDEN);
    });
  });

  describe('recipients', () => {
    it('allows signer contact emails, placeholder emails and the owner email', async () => {
      await callAsOwner({ recipient: owner.signer.get('Email').toUpperCase() });
      await callAsOwner({ recipient: owner.placeholderEmail });
      await callAsOwner({ recipient: owner.extUser.get('Email') });

      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    ['recipient', 'cc', 'bcc'].forEach(field => {
      it(`forbids a foreign address in ${field} and sends nothing`, async () => {
        const thrown = await captureRejection(callAsOwner({ [field]: 'attacker@evil.test' }));

        expect(thrown.code).toBe(OPERATION_FORBIDDEN);
        expect(fetchSpy).not.toHaveBeenCalled();
      });
    });

    it('allows allowed addresses in cc and bcc', async () => {
      const result = await callAsOwner({
        cc: owner.placeholderEmail,
        bcc: [owner.extUser.get('Email')],
      });

      expect(result).toEqual({ status: 'success' });
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });
  });

  describe('mail counting', () => {
    it('ignores the client extUserId and counts for the document owner', async () => {
      const victimAccount = await createPlainUser(uniqueEmail('mail-victim'));
      const victim = await createExtUser({ account: victimAccount, role: 'contracts_User' });
      const ownerBefore = await readEmailCount(owner.extUser);
      const victimBefore = await readEmailCount(victim);

      await callAsOwner({ extUserId: victim.id });

      expect(await readEmailCount(victim)).toBe(victimBefore);
      expect(await readEmailCount(owner.extUser)).toBe(ownerBefore + 1);
    });
  });

  describe('per user limit', () => {
    it('answers 155 after the configured calls and sends nothing more', async () => {
      process.env.SENDMAILV3_USER_LIMIT = '2';
      await callAsOwner({});
      await callAsOwner({});

      const thrown = await captureRejection(callAsOwner({}));

      expect(thrown.code).toBe(REQUEST_LIMIT_EXCEEDED);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('defaults to 100 calls per window', async () => {
      for (let index = 0; index < 100; index += 1) await callAsOwner({});

      const thrown = await captureRejection(callAsOwner({}));

      expect(thrown.code).toBe(REQUEST_LIMIT_EXCEEDED);
    });
  });

  describe('master and in-process delivery', () => {
    it('bypasses authorization when called with the master key', async () => {
      const result = await sendmailv3({
        params: { recipient: 'anyone@x.com', subject: 'S', html: '<p>h</p>' },
        master: true,
      });

      expect(result).toEqual({ status: 'success' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('does not rate limit master calls', async () => {
      process.env.SENDMAILV3_USER_LIMIT = '1';
      const params = { recipient: 'anyone@x.com', subject: 'S', html: '<p>h</p>' };

      await sendmailv3({ params, master: true });
      const result = await sendmailv3({ params, master: true });

      expect(result).toEqual({ status: 'success' });
    });

    it('keeps deliverMailv3 unrestricted for server code', async () => {
      const result = await deliverMailv3({
        params: { recipient: 'new-signer@x.com', subject: 'S', html: '<p>h</p>' },
      });

      expect(result).toEqual({ status: 'success' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('wrapper delivery options', () => {
    const deliverSpy = () => jasmine.createSpy('deliver').and.resolveTo({ status: 'success' });

    it('delivers user initiated mail through the bulk lane', async () => {
      const deliver = deliverSpy();

      await sendmailv3({ params: paramsFor(), user: ownerUser }, { deliver });

      expect(deliver.calls.mostRecent().args[1]).toEqual({ lane: CommsLane.BULK });
    });

    it('delivers master mail through the bulk lane', async () => {
      const deliver = deliverSpy();

      await sendmailv3({ params: { recipient: 'a@x.com' }, master: true }, { deliver });

      expect(deliver.calls.mostRecent().args[1]).toEqual({ lane: CommsLane.BULK });
    });

    it('sanitizes the client supplied from name', async () => {
      const deliver = deliverSpy();
      const from = '  "Evil"\r\nBcc: x@y.com <a@b.c>' + 'z'.repeat(200);

      await sendmailv3({ params: paramsFor({ from }), user: ownerUser }, { deliver });

      const delivered = deliver.calls.mostRecent().args[0].params.from;
      expect(delivered).not.toMatch(/[\r\n<>"]/);
      expect(delivered.length).toBeLessThanOrEqual(100);
      expect(delivered.startsWith('EvilBcc: xy.com ab.c')).toBe(true);
    });

    it('sanitizes the from name for master calls too', async () => {
      const deliver = deliverSpy();

      await sendmailv3(
        { params: { recipient: 'a@x.com', from: 'A\nB' }, master: true },
        { deliver }
      );

      expect(deliver.calls.mostRecent().args[0].params.from).toBe('AB');
    });

    it('passes the document owner ext user id to delivery', async () => {
      const deliver = deliverSpy();

      await sendmailv3(
        { params: paramsFor({ extUserId: 'victim' }), user: ownerUser },
        { deliver }
      );

      expect(deliver.calls.mostRecent().args[0].params.extUserId).toBe(owner.extUser.id);
    });
  });
});
