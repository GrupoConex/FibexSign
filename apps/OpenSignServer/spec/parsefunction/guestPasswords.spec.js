import {
  PASSWORD,
  captureRejection,
  cloudRunAs,
  createCaller,
  createPlainUser,
  findUserByUsername,
  resetAuthState,
  silenceConsole,
  uniqueEmail,
  waitUntil,
} from '../utils/auth-fixtures.js';
import { generateGuestPassword } from '../../cloud/parsefunction/shared/createUserAccount.js';

const MASTER = { useMasterKey: true };

const loginFails = async (email, password) => {
  await resetAuthState();
  const error = await captureRejection(Parse.User.logIn(email, password));
  await resetAuthState();
  return error?.code === Parse.Error.OBJECT_NOT_FOUND;
};

const expectGuestHasNoEmailPassword = async email => {
  const account = await findUserByUsername(email);
  expect(account).toBeDefined();
  expect(await loginFails(email, email)).toBeTrue();
  expect(await loginFails(email, email.toUpperCase())).toBeTrue();
  return account;
};

describe('guest signer account passwords', () => {
  beforeAll(async () => {
    const seed = new Parse.Object('contracts_Contactbook');
    seed.set('Email', 'class-seed@example.com');
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

  describe('generateGuestPassword', () => {
    it('produces long unpredictable hex strings', () => {
      const passwords = Array.from({ length: 50 }, generateGuestPassword);

      passwords.forEach(password => expect(password).toMatch(/^[0-9a-f]{64}$/));
      expect(new Set(passwords).size).toBe(passwords.length);
    });
  });

  it('savecontact creates the guest account without the email as password', async () => {
    const caller = await createCaller('contracts_Admin');
    const email = uniqueEmail('guest-savecontact');

    await cloudRunAs(
      'savecontact',
      { name: 'Guest', email, tenantId: caller.tenant.id },
      caller.account.sessionToken
    );

    await expectGuestHasNoEmailPassword(email);
  });

  it('savecontact rotates the password of an unverified pre-existing account when it links it', async () => {
    const caller = await createCaller('contracts_Admin');
    const existing = await createPlainUser(uniqueEmail('guest-existing'));

    await cloudRunAs(
      'savecontact',
      { name: 'Guest', email: existing.email, tenantId: caller.tenant.id },
      caller.account.sessionToken
    );

    expect(await loginFails(existing.email, PASSWORD)).toBeTrue();
  });

  it('editcontact creates the replacement guest account without the email as password', async () => {
    const caller = await createCaller('contracts_Admin');
    const previousEmail = uniqueEmail('guest-before-edit');
    const created = await cloudRunAs(
      'savecontact',
      { name: 'Guest', email: previousEmail, tenantId: caller.tenant.id },
      caller.account.sessionToken
    );
    const email = uniqueEmail('guest-after-edit');

    await cloudRunAs(
      'editcontact',
      { contactId: created.objectId, name: 'Guest', email, tenantId: caller.tenant.id },
      caller.account.sessionToken
    );

    await expectGuestHasNoEmailPassword(email);
  });

  it('linkcontacttodoc creates the guest account without the email as password', async () => {
    const caller = await createCaller('contracts_Admin');
    const email = uniqueEmail('guest-link');
    const document = new Parse.Object('contracts_Document');
    document.set('Name', 'Doc');
    document.set('Placeholders', [{ email, Id: 1 }]);
    document.set('CreatedBy', {
      __type: 'Pointer',
      className: '_User',
      objectId: caller.account.id,
    });
    const acl = new Parse.ACL();
    acl.setReadAccess(caller.account.id, true);
    acl.setWriteAccess(caller.account.id, true);
    document.setACL(acl);
    await document.save(null, MASTER);

    const result = await Parse.Cloud.run('linkcontacttodoc', {
      docId: document.id,
      email,
      name: 'Guest',
    });

    expect(result.contactId).toBeDefined();
    await expectGuestHasNoEmailPassword(email);
  });

  it('the contact book afterSave creates the guest account without the email as password', async () => {
    const email = uniqueEmail('guest-aftersave');
    const contact = new Parse.Object('contracts_Contactbook');
    contact.set('Name', 'Guest');
    contact.set('Email', email);
    await contact.save(null, MASTER);

    const created = await waitUntil(async () => Boolean(await findUserByUsername(email)));

    expect(created).toBeTrue();
    await expectGuestHasNoEmailPassword(email);
  });
});
