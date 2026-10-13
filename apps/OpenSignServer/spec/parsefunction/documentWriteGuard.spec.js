import axios from 'axios';
import {
  PASSWORD,
  createCaller,
  createOrganization,
  createTeam,
  createTenantMember,
  createTenantScope,
  pointer,
  resetAuthState,
  silenceConsole,
  uniqueEmail,
} from '../utils/auth-fixtures.js';
import { fileUrl, seedContact, seedDocument, trustedFileUrl } from '../utils/document-fixtures.js';

const MASTER = { useMasterKey: true };

const rest = (method, path, sessionToken, data) =>
  axios({
    method,
    url: `${process.env.SERVER_URL}${path}`,
    data,
    headers: {
      'X-Parse-Application-Id': process.env.APP_ID,
      'X-Parse-Javascript-Key': 'test',
      'X-Parse-Session-Token': sessionToken,
    },
    validateStatus: () => true,
  });

const postDocument = (sessionToken, data) =>
  rest('post', '/classes/contracts_Document', sessionToken, data);

const putDocument = (documentId, sessionToken, data) =>
  rest('put', `/classes/contracts_Document/${documentId}`, sessionToken, data);

const reloadDocument = documentId => new Parse.Query('contracts_Document').get(documentId, MASTER);

describe('contracts_Document write guard (documentWriteGuard)', () => {
  let restoreConsole;
  let owner;
  let otherUser;

  beforeAll(async () => {
    restoreConsole = silenceConsole();
    await resetAuthState();
    const scope = await createTenantScope();
    owner = await createTenantMember('contracts_Admin', scope, 'doc-owner');
    otherUser = await createCaller('doc-other-user');
  });

  afterAll(async () => {
    await resetAuthState();
    restoreConsole();
  });

  describe('master key bypass', () => {
    it('allows saving and modifying documents with master key', async () => {
      const doc = new Parse.Object('contracts_Document');
      doc.set({
        Name: 'Master Created',
        URL: fileUrl('any-storage.pdf'),
        CreatedBy: pointer('_User', owner.account.id),
        ExtUserPtr: pointer('contracts_Users', owner.extUser.id),
        IsCompleted: true,
      });
      const saved = await doc.save(null, MASTER);
      expect(saved.id).toBeDefined();
      expect(saved.get('IsCompleted')).toBe(true);

      saved.set('AuditTrail', [{ Activity: 'Signed', ipAddress: '127.0.0.1' }]);
      const updated = await saved.save(null, MASTER);
      expect(updated.get('AuditTrail').length).toBe(1);
    });
  });

  describe('unauthenticated requests', () => {
    it('rejects unauthenticated document creation', async () => {
      const res = await postDocument(undefined, {
        Name: 'Anonymous Doc',
        URL: trustedFileUrl('doc.pdf'),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.data.code).toBe(Parse.Error.OPERATION_FORBIDDEN);
    });

    it('rejects unauthenticated document update', async () => {
      const doc = await seedDocument(owner);
      const res = await putDocument(doc.id, undefined, {
        Name: 'Tampered Name',
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.data.code).toBe(Parse.Error.OPERATION_FORBIDDEN);
    });
  });

  describe('document creation by client', () => {
    it('forces CreatedBy and ExtUserPtr from caller session even if forged', async () => {
      const res = await postDocument(owner.account.sessionToken, {
        Name: 'Client Document',
        URL: trustedFileUrl('client.pdf'),
        CreatedBy: pointer('_User', otherUser.account.id),
        ExtUserPtr: pointer('contracts_Users', otherUser.extUser.id),
      });

      expect(res.status).toBe(201);
      const created = await reloadDocument(res.data.objectId);
      expect(created.get('CreatedBy').id).toBe(owner.account.id);
      expect(created.get('ExtUserPtr').id).toBe(owner.extUser.id);
      expect(created.getACL().getReadAccess(owner.account.id)).toBe(true);
      expect(created.getACL().getWriteAccess(owner.account.id)).toBe(true);
      expect(created.getACL().getPublicReadAccess()).toBeFalsy();
    });

    it('rejects IsCompleted=true on document creation', async () => {
      const res = await postDocument(owner.account.sessionToken, {
        Name: 'Fake Completed Doc',
        URL: trustedFileUrl('fake.pdf'),
        IsCompleted: true,
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.data.code).toBe(Parse.Error.OPERATION_FORBIDDEN);
    });

    it('rejects untrusted storage URLs on creation', async () => {
      const res = await postDocument(owner.account.sessionToken, {
        Name: 'Untrusted Storage Doc',
        URL: 'https://evil-storage.com/exploit.pdf',
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.data.code).toBe(Parse.Error.INVALID_JSON);
    });

    it('rejects unauthorized foreign contacts in signers', async () => {
      const foreignContact = await seedContact(otherUser, otherUser.account);
      const res = await postDocument(owner.account.sessionToken, {
        Name: 'Doc with Foreign Signer',
        URL: trustedFileUrl('legal.pdf'),
        Signers: [pointer('contracts_Contactbook', foreignContact.id)],
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.data.code).toBe(Parse.Error.OPERATION_FORBIDDEN);
    });

    it('authorizes own contacts and grants them read/write in ACL', async () => {
      const ownContact = await seedContact(owner, otherUser.account);
      const res = await postDocument(owner.account.sessionToken, {
        Name: 'Doc with Authorized Signer',
        URL: trustedFileUrl('legal.pdf'),
        Signers: [pointer('contracts_Contactbook', ownContact.id)],
      });

      expect(res.status).toBe(201);
      const created = await reloadDocument(res.data.objectId);
      const acl = created.getACL();
      expect(acl.getReadAccess(owner.account.id)).toBe(true);
      expect(acl.getWriteAccess(owner.account.id)).toBe(true);
      expect(acl.getReadAccess(otherUser.account.id)).toBe(true);
      expect(acl.getWriteAccess(otherUser.account.id)).toBe(true);
      expect(acl.getPublicReadAccess()).toBeFalsy();
    });
  });

  describe('document update by owner', () => {
    it('allows owner to update legitimate draft fields (Name, Note, Description, IsArchive)', async () => {
      const doc = await seedDocument(owner);
      const res = await putDocument(doc.id, owner.account.sessionToken, {
        Name: 'Updated Document Name',
        Note: 'Please sign promptly',
        Description: 'Contract for Q4',
        IsArchive: false,
      });

      expect(res.status).toBe(200);
      const updated = await reloadDocument(doc.id);
      expect(updated.get('Name')).toBe('Updated Document Name');
      expect(updated.get('Note')).toBe('Please sign promptly');
      expect(updated.get('Description')).toBe('Contract for Q4');
    });

    it('forbids owner from changing CreatedBy or ExtUserPtr', async () => {
      const doc = await seedDocument(owner);
      const res = await putDocument(doc.id, owner.account.sessionToken, {
        CreatedBy: pointer('_User', otherUser.account.id),
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.data.code).toBe(Parse.Error.OPERATION_FORBIDDEN);
    });

    it('forbids owner from manually changing IsCompleted', async () => {
      const doc = await seedDocument(owner);
      const res = await putDocument(doc.id, owner.account.sessionToken, {
        IsCompleted: true,
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.data.code).toBe(Parse.Error.OPERATION_FORBIDDEN);
    });

    it('forbids owner from manually forging AuditTrail', async () => {
      const doc = await seedDocument(owner);
      const res = await putDocument(doc.id, owner.account.sessionToken, {
        AuditTrail: [{ Activity: 'Signed', ipAddress: '1.2.3.4' }],
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.data.code).toBe(Parse.Error.OPERATION_FORBIDDEN);
    });

    it('rejects untrusted storage URLs when updating URL or SignedUrl', async () => {
      const doc = await seedDocument(owner);
      const res = await putDocument(doc.id, owner.account.sessionToken, {
        URL: 'https://attacker.site/doc.pdf',
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.data.code).toBe(Parse.Error.INVALID_JSON);
    });

    it('forbids owner from making ACL public directly', async () => {
      const doc = await seedDocument(owner);
      const res = await putDocument(doc.id, owner.account.sessionToken, {
        ACL: { '*': { read: true, write: true } },
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.data.code).toBe(Parse.Error.OPERATION_FORBIDDEN);
    });
  });

  describe('document update by non-owner / signer (Decision D2)', () => {
    let sharedDoc;

    beforeEach(async () => {
      const contact = await seedContact(owner, otherUser.account);
      sharedDoc = await seedDocument(owner, {
        Signers: [pointer('contracts_Contactbook', contact.id)],
      });
      // Set ACL granting otherUser read/write
      const acl = new Parse.ACL();
      acl.setReadAccess(owner.account.id, true);
      acl.setWriteAccess(owner.account.id, true);
      acl.setReadAccess(otherUser.account.id, true);
      acl.setWriteAccess(otherUser.account.id, true);
      sharedDoc.setACL(acl);
      await sharedDoc.save(null, MASTER);
    });

    it('allows a non-owner signer to update IsArchive (Decision D2)', async () => {
      const res = await putDocument(sharedDoc.id, otherUser.account.sessionToken, {
        IsArchive: true,
      });

      expect(res.status).toBe(200);
      const updated = await reloadDocument(sharedDoc.id);
      expect(updated.get('IsArchive')).toBe(true);
    });

    it('rejects a non-owner signer modifying document Name', async () => {
      const res = await putDocument(sharedDoc.id, otherUser.account.sessionToken, {
        Name: 'Hacked Title By Signer',
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.data.code).toBe(Parse.Error.OPERATION_FORBIDDEN);
    });

    it('rejects a non-owner signer modifying URL', async () => {
      const res = await putDocument(sharedDoc.id, otherUser.account.sessionToken, {
        URL: trustedFileUrl('replacement.pdf'),
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.data.code).toBe(Parse.Error.OPERATION_FORBIDDEN);
    });

    it('rejects a non-owner signer modifying Signers or ACL', async () => {
      const res = await putDocument(sharedDoc.id, otherUser.account.sessionToken, {
        Signers: [],
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.data.code).toBe(Parse.Error.OPERATION_FORBIDDEN);
    });
  });
});
