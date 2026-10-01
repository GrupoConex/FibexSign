import axios from 'axios';
import ContactbookAftersave from '../../cloud/parsefunction/ContactBookAftersave.js';
import {
  PASSWORD,
  canReadDocument,
  captureRejection,
  cloudRunAs,
  createCaller,
  createPlainUser,
  openPasswordSession,
  createTenantMember,
  isSessionValid,
  loginRejected,
  markEmailVerified,
  pointer,
  resetAuthState,
  silenceConsole,
  uniqueEmail,
  waitUntil,
  stubFirstFor,
} from '../utils/auth-fixtures.js';

const MASTER = { useMasterKey: true };
const ATTACKER_PASSWORD = 'Attacker-Known-Pass1!';
const MEMBER_PASSWORD = 'Member-Passw0rd!';

const publicHeaders = () => ({
  'X-Parse-Application-Id': process.env.APP_ID,
  'X-Parse-Javascript-Key': 'test',
});

const preRegister = email => createPlainUser(email, ATTACKER_PASSWORD);

const preRegisterWithAuthData = async email => {
  const response = await axios.post(
    `${process.env.SERVER_URL}/users`,
    {
      username: email,
      email,
      password: ATTACKER_PASSWORD,
      authData: { anonymous: { id: uniqueEmail('anon') } },
    },
    {
      headers: {
        'X-Parse-Application-Id': process.env.APP_ID,
        'X-Parse-Master-Key': process.env.MASTER_KEY,
      },
    }
  );
  return { id: response.data.objectId, email, sessionToken: response.data.sessionToken };
};

const readUser = userId => new Parse.Query(Parse.User).get(userId, MASTER);

const createDocument = async (caller, email) => {
  const document = new Parse.Object('contracts_Document');
  document.set('Name', 'Confidential');
  document.set('Placeholders', [{ email, Id: 1 }]);
  document.set('CreatedBy', pointer('_User', caller.account.id));
  document.set('ExtUserPtr', pointer('contracts_Users', caller.extUser.id));
  const acl = new Parse.ACL();
  acl.setReadAccess(caller.account.id, true);
  acl.setWriteAccess(caller.account.id, true);
  document.setACL(acl);
  return document.save(null, MASTER);
};

const readAcl = async documentId => {
  const stored = await new Parse.Query('contracts_Document').get(documentId, MASTER);
  return stored.getACL();
};

const expectLockedOut = async (attacker, password = ATTACKER_PASSWORD) => {
  expect(await loginRejected(attacker.email, password)).toBeTrue();
  expect(await isSessionValid(attacker.sessionToken)).toBeFalse();
};

const expectUntouched = async (account, password = ATTACKER_PASSWORD) => {
  expect(await loginRejected(account.email, password)).toBeFalse();
  expect(await isSessionValid(account.sessionToken)).toBeTrue();
};

const addUserParams = (caller, email) => ({
  name: 'New Member',
  email,
  password: MEMBER_PASSWORD,
  organization: { objectId: caller.organization.id, company: 'Acme' },
  team: caller.team.id,
  role: 'Editor',
  tenantId: caller.tenant.id,
});

const saveContactAs = (caller, email) =>
  cloudRunAs(
    'savecontact',
    { name: 'Guest', email, tenantId: caller.tenant.id },
    caller.account.sessionToken
  );

const becomeAnonymousAdmin = async () => {
  const details = {
    email: uniqueEmail('anon-admin'),
    password: ATTACKER_PASSWORD,
    name: 'Mallory',
    company: 'Evil Corp',
    role: 'contracts_Admin',
  };
  await Parse.Cloud.run('addadmin', { userDetails: details });
  await Parse.User.logOut();
  const sessionToken = await openPasswordSession(details.email, ATTACKER_PASSWORD);
  const account = await new Parse.Query(Parse.User)
    .equalTo('username', details.email)
    .first(MASTER);
  const extUser = await new Parse.Query('contracts_Users')
    .equalTo('UserId', pointer('_User', account.id))
    .first(MASTER);
  return {
    account: { id: account.id, email: details.email, sessionToken },
    extUser,
    tenant: { id: extUser.get('TenantId').id },
    organization: { id: extUser.get('OrganizationId').id },
    team: { id: extUser.get('TeamIds')[0].id },
  };
};

const plantMember = async (mallory, email = uniqueEmail('planted-victim')) => {
  await cloudRunAs('adduser', addUserParams(mallory, email), mallory.account.sessionToken);
  const sessionToken = await openPasswordSession(email, MEMBER_PASSWORD);
  const account = await new Parse.Query(Parse.User).equalTo('username', email).first(MASTER);
  return { id: account.id, email, sessionToken };
};

describe('H1 account pre-registration takeover', () => {
  beforeAll(async () => {
    const seed = new Parse.Object('contracts_Contactbook');
    seed.set('Email', 'h1-class-seed@example.com');
    await seed.save(null, MASTER);
    await seed.destroy(MASTER);
  });

  beforeEach(async () => {
    silenceConsole();
    await resetAuthState();
  });

  afterEach(async () => {
    await resetAuthState();
  });

  describe('public signup', () => {
    it('rejects an anonymous POST /users with credentials', async () => {
      const email = uniqueEmail('public-signup');

      const response = await axios.post(
        `${process.env.SERVER_URL}/users`,
        { username: email, email, password: ATTACKER_PASSWORD },
        { headers: publicHeaders(), validateStatus: () => true }
      );

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.data.code).toBe(Parse.Error.OPERATION_FORBIDDEN);
      const stored = await new Parse.Query(Parse.User).equalTo('username', email).first(MASTER);
      expect(stored).toBeUndefined();
    });

    it('rejects an anonymous provider signup', async () => {
      const response = await axios.post(
        `${process.env.SERVER_URL}/users`,
        { authData: { anonymous: { id: uniqueEmail('anon-public') } } },
        { headers: publicHeaders(), validateStatus: () => true }
      );

      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('adduser orphan link', () => {
    it('locks the pre-registrant out of the linked account', async () => {
      const caller = await createCaller('contracts_Admin');
      const attacker = await preRegister(uniqueEmail('h1-adduser'));

      const result = await cloudRunAs(
        'adduser',
        addUserParams(caller, attacker.email),
        caller.account.sessionToken
      );

      expect(result.UserId.id).toBe(attacker.id);
      await expectLockedOut(attacker);
    });

    it('does not touch an account that already belongs to a tenant', async () => {
      const caller = await createCaller('contracts_Admin');
      const owner = await createTenantMember('contracts_Admin', caller, 'h1-adduser-owner');

      const error = await captureRejection(
        cloudRunAs(
          'adduser',
          addUserParams(caller, owner.account.email),
          caller.account.sessionToken
        )
      );

      expect(error.code).toBe(Parse.Error.DUPLICATE_VALUE);
      await expectUntouched(owner.account, PASSWORD);
    });
  });

  describe('savecontact', () => {
    it('locks the pre-registrant out of the linked account', async () => {
      const caller = await createCaller('contracts_Admin');
      const attacker = await preRegister(uniqueEmail('h1-savecontact'));

      const contact = await saveContactAs(caller, attacker.email);

      expect(contact.UserId.id).toBe(attacker.id);
      await expectLockedOut(attacker);
    });

    it('removes the provider credentials of the pre-registered account', async () => {
      const caller = await createCaller('contracts_Admin');
      const attacker = await preRegisterWithAuthData(uniqueEmail('h1-authdata'));

      await saveContactAs(caller, attacker.email);

      expect((await readUser(attacker.id)).get('authData')).toBeFalsy();
      await expectLockedOut(attacker);
    });

    it('does not touch a verified account', async () => {
      const caller = await createCaller('contracts_Admin');
      const owner = await preRegister(uniqueEmail('h1-verified'));
      await markEmailVerified(owner.id);

      await saveContactAs(caller, owner.email);

      await expectUntouched(owner);
    });

    it('does not touch the account of a tenant member', async () => {
      const caller = await createCaller('contracts_Admin');
      const member = await createTenantMember('contracts_User', caller, 'h1-member');

      await saveContactAs(caller, member.account.email);

      await expectUntouched(member.account, PASSWORD);
    });
  });

  describe('editcontact', () => {
    it('locks the pre-registrant out of the account of the replacement contact', async () => {
      const caller = await createCaller('contracts_Admin');
      const previous = await saveContactAs(caller, uniqueEmail('h1-edit-before'));
      const attacker = await preRegister(uniqueEmail('h1-edit-after'));

      const edited = await cloudRunAs(
        'editcontact',
        {
          contactId: previous.objectId,
          name: 'Guest',
          email: attacker.email,
          tenantId: caller.tenant.id,
        },
        caller.account.sessionToken
      );

      expect(edited.UserId.id).toBe(attacker.id);
      await expectLockedOut(attacker);
    });
  });

  describe('linkcontacttodoc', () => {
    it('locks the pre-registrant out before the account is added to the document', async () => {
      const caller = await createCaller('contracts_Admin');
      const attacker = await preRegister(uniqueEmail('h1-link-user'));
      const document = await createDocument(caller, attacker.email);

      await Parse.Cloud.run('linkcontacttodoc', {
        docId: document.id,
        email: attacker.email,
        name: 'Guest',
      });

      expect((await readAcl(document.id)).getReadAccess(attacker.id)).toBeTrue();
      await expectLockedOut(attacker);
      expect(await canReadDocument(attacker.sessionToken, document.id)).toBeFalse();
    });

    it('locks the pre-registrant out when a contact already points at the account', async () => {
      const caller = await createCaller('contracts_Admin');
      const attacker = await preRegister(uniqueEmail('h1-link-contact'));
      const contact = new Parse.Object('contracts_Contactbook');
      contact.set('Name', 'Guest');
      contact.set('Email', attacker.email);
      contact.set('IsDeleted', false);
      contact.set('CreatedBy', pointer('_User', caller.account.id));
      contact.set('UserId', pointer('_User', attacker.id));
      await contact.save(null, MASTER);
      const document = await createDocument(caller, attacker.email);

      await Parse.Cloud.run('linkcontacttodoc', { docId: document.id, email: attacker.email });

      expect((await readAcl(document.id)).getReadAccess(attacker.id)).toBeTrue();
      await expectLockedOut(attacker);
      expect(await canReadDocument(attacker.sessionToken, document.id)).toBeFalse();
    });

    it('does not touch the account of a verified owner', async () => {
      const caller = await createCaller('contracts_Admin');
      const owner = await preRegister(uniqueEmail('h1-link-verified'));
      await markEmailVerified(owner.id);
      const document = await createDocument(caller, owner.email);

      await Parse.Cloud.run('linkcontacttodoc', {
        docId: document.id,
        email: owner.email,
        name: 'Guest',
      });

      await expectUntouched(owner);
    });
  });

  describe('member planted through an anonymous admin tenant', () => {
    it('locks the planted member out when another tenant links it through savecontact', async () => {
      const mallory = await becomeAnonymousAdmin();
      const victim = await plantMember(mallory);
      const caller = await createCaller('contracts_Admin');

      await saveContactAs(caller, victim.email);

      await expectLockedOut(victim, MEMBER_PASSWORD);
    });

    it('locks the planted member out and keeps the document unreadable through linkcontacttodoc', async () => {
      const mallory = await becomeAnonymousAdmin();
      const victim = await plantMember(mallory);
      const caller = await createCaller('contracts_Admin');
      const document = await createDocument(caller, victim.email);

      await Parse.Cloud.run('linkcontacttodoc', { docId: document.id, email: victim.email });

      expect((await readAcl(document.id)).getReadAccess(victim.id)).toBeTrue();
      await expectLockedOut(victim, MEMBER_PASSWORD);
      expect(await canReadDocument(victim.sessionToken, document.id)).toBeFalse();
    });

    it('does not accept a client supplied tenant id as proof of membership', async () => {
      const mallory = await becomeAnonymousAdmin();
      const victim = await plantMember(mallory);
      const caller = await createCaller('contracts_Admin');

      await cloudRunAs(
        'savecontact',
        { name: 'Guest', email: victim.email, tenantId: mallory.tenant.id },
        caller.account.sessionToken
      );

      await expectLockedOut(victim, MEMBER_PASSWORD);
    });

    it('does not rotate a member that the linking tenant itself manages', async () => {
      const caller = await createCaller('contracts_Admin');
      const member = await createTenantMember('contracts_User', caller, 'h1-same-tenant');
      const document = await createDocument(caller, member.account.email);

      await Parse.Cloud.run('linkcontacttodoc', {
        docId: document.id,
        email: member.account.email,
      });

      await expectUntouched(member.account, PASSWORD);
    });

    it('does not rotate the owner of another tenant', async () => {
      const owner = await becomeAnonymousAdmin();
      const caller = await createCaller('contracts_Admin');

      await saveContactAs(caller, owner.account.email);

      await expectUntouched(owner.account, ATTACKER_PASSWORD);
    });

    it('does not let a disabled membership exempt the account', async () => {
      const caller = await createCaller('contracts_Admin');
      const member = await createTenantMember('contracts_User', caller, 'h1-disabled');
      member.extUser.set('IsDisabled', true);
      await member.extUser.save(null, MASTER);

      await saveContactAs(caller, member.account.email);

      await expectLockedOut(member.account, PASSWORD);
    });

    it('does not exempt an account when the caller belongs to no tenant', async () => {
      const mallory = await becomeAnonymousAdmin();
      const victim = await plantMember(mallory);
      const tenantless = await createPlainUser(uniqueEmail('tenantless'));

      await cloudRunAs(
        'savecontact',
        { name: 'Guest', email: victim.email, tenantId: mallory.tenant.id },
        tenantless.sessionToken
      );

      await expectLockedOut(victim, MEMBER_PASSWORD);
    });
  });

  describe('mixed case emails', () => {
    it('editcontact finds and locks out the account when the email has other casing', async () => {
      const caller = await createCaller('contracts_Admin');
      const previous = await saveContactAs(caller, uniqueEmail('h1-case-before'));
      const attacker = await preRegister(uniqueEmail('h1-case-after'));

      await cloudRunAs(
        'editcontact',
        {
          contactId: previous.objectId,
          name: 'Guest',
          email: ` ${attacker.email.toUpperCase()} `,
          tenantId: caller.tenant.id,
        },
        caller.account.sessionToken
      );

      await expectLockedOut(attacker);
    });

    it('savecontact finds and locks out the account when the email has other casing', async () => {
      const caller = await createCaller('contracts_Admin');
      const attacker = await preRegister(uniqueEmail('h1-case-save'));

      await saveContactAs(caller, attacker.email.toUpperCase());

      await expectLockedOut(attacker);
    });

    it('linkcontacttodoc fails with a controlled error when the contact has no account', async () => {
      const caller = await createCaller('contracts_Admin');
      const email = uniqueEmail('h1-no-account');
      const contact = new Parse.Object('contracts_Contactbook');
      contact.set('Name', 'Guest');
      contact.set('Email', email);
      contact.set('IsDeleted', false);
      contact.set('CreatedBy', pointer('_User', caller.account.id));
      contact.set('UserId', pointer('_User', caller.account.id));
      await contact.save(null, MASTER);
      contact.unset('UserId');
      await contact.save(null, MASTER);
      const document = await createDocument(caller, email);

      const error = await captureRejection(
        Parse.Cloud.run('linkcontacttodoc', { docId: document.id, email })
      );

      expect(error.code).toBe(Parse.Error.OBJECT_NOT_FOUND);
      expect(error.message).toBe('User not found.');
    });
  });

  describe('contact book afterSave', () => {
    it('locks the pre-registrant out of the account it links', async () => {
      const attacker = await preRegister(uniqueEmail('h1-aftersave'));
      const contact = new Parse.Object('contracts_Contactbook');
      contact.set('Name', 'Guest');
      contact.set('Email', attacker.email);

      await contact.save(null, MASTER);

      const linked = await waitUntil(async () => {
        const stored = await new Parse.Query('contracts_Contactbook').get(contact.id, MASTER);
        return Boolean(stored.get('UserId'));
      });
      expect(linked).toBeTrue();
      await expectLockedOut(attacker);
    });
  });

  describe('contact book afterSave account lookup', () => {
    it('fails with a controlled error when the existing account cannot be found', async () => {
      const attacker = await preRegister(uniqueEmail('h1-aftersave-missing'));
      const contact = new Parse.Object('contracts_Contactbook');
      contact.set('Name', 'Guest');
      contact.set('Email', attacker.email);
      stubFirstFor('_User', undefined);

      const error = await captureRejection(ContactbookAftersave({ object: contact }));

      expect(error.code).toBe(Parse.Error.OBJECT_NOT_FOUND);
    });
  });
});
