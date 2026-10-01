import {
  captureRejection,
  cloudRunAs,
  createCaller,
  silenceConsole,
  resetAuthState,
  uniqueEmail,
} from '../utils/auth-fixtures.js';

const MASTER = { useMasterKey: true };

const createUserWithUsernameOnly = async username => {
  const account = new Parse.User();
  account.set('username', username);
  account.set('email', `other-${username}`);
  account.set('password', 'Sup3r-secret-Pass!');
  await account.save(null, MASTER);
  return account;
};

const findContactsByEmail = email => {
  const query = new Parse.Query('contracts_Contactbook');
  query.equalTo('Email', email);
  return query.find(MASTER);
};

const expectUserNotFound = error => {
  expect(error).not.toBeNull();
  expect(error.code).toBe(Parse.Error.OBJECT_NOT_FOUND);
  expect(error.message).toBe('User not found.');
};

describe('contact guest account lookup after a taken username', () => {
  beforeAll(async () => {
    const seed = new Parse.Object('contracts_Contactbook');
    seed.set('Email', 'class-seed-lookup@example.com');
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

  it('savecontact rejects with user not found and stores no contact when the taken username has no matching email', async () => {
    const caller = await createCaller('contracts_Admin');
    const email = uniqueEmail('lookup-save');
    await createUserWithUsernameOnly(email);

    const error = await captureRejection(
      cloudRunAs(
        'savecontact',
        { name: 'Guest', email, tenantId: caller.tenant.id },
        caller.account.sessionToken
      )
    );

    expectUserNotFound(error);
    expect(await findContactsByEmail(email)).toEqual([]);
  });

  it('editcontact rejects with user not found and stores no contact for the new email when the taken username has no matching email', async () => {
    const caller = await createCaller('contracts_Admin');
    const created = await cloudRunAs(
      'savecontact',
      { name: 'Guest', email: uniqueEmail('lookup-before'), tenantId: caller.tenant.id },
      caller.account.sessionToken
    );
    const email = uniqueEmail('lookup-edit');
    await createUserWithUsernameOnly(email);

    const error = await captureRejection(
      cloudRunAs(
        'editcontact',
        { contactId: created.objectId, name: 'Guest', email, tenantId: caller.tenant.id },
        caller.account.sessionToken
      )
    );

    expectUserNotFound(error);
    expect(await findContactsByEmail(email)).toEqual([]);
  });
});
