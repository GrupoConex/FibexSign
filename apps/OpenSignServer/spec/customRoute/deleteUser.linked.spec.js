import axios from 'axios';
import {
  PASSWORD,
  captureRejection,
  cloudRunAs,
  createCaller,
  createPlainUser,
  createTenantMember,
  findFirstByUserId,
  resetAuthState,
  silenceConsole,
  uniqueEmail,
} from '../utils/auth-fixtures.js';

const MASTER = { useMasterKey: true };
const ROUTE_ROOT = 'http://localhost:30001';

const stubSessionLookup = admin => {
  const originalGet = axios.get.bind(axios);
  spyOn(axios, 'get').and.callFake((url, ...args) =>
    String(url).endsWith('/users/me')
      ? Promise.resolve({ data: { objectId: admin.account.id } })
      : originalGet(url, ...args)
  );
};

const deleteAs = (admin, userId) => {
  stubSessionLookup(admin);
  return axios.post(
    `${ROUTE_ROOT}/deleteuser/${userId}`,
    {},
    {
      headers: { sessiontoken: admin.account.sessionToken },
      validateStatus: () => true,
    }
  );
};

const linkGuestInto = (admin, guest) =>
  cloudRunAs(
    'adduser',
    {
      name: 'Linked Guest',
      email: guest.email,
      password: 'Attacker-Passw0rd!',
      organization: { objectId: admin.organization.id },
      team: admin.team.id,
      role: 'User',
      tenantId: admin.tenant.id,
    },
    admin.account.sessionToken
  );

const userStillExists = async userId => {
  const account = await new Parse.Query(Parse.User).equalTo('objectId', userId).first(MASTER);
  return Boolean(account);
};

describe('deleteuser route and linked accounts', () => {
  beforeEach(async () => {
    silenceConsole();
    await resetAuthState();
  });

  afterEach(async () => {
    await resetAuthState();
  });

  it('does not let a tenant admin delete a guest account it linked', async () => {
    const admin = await createCaller('contracts_Admin');
    const guest = await createPlainUser(uniqueEmail('guest-linked'));
    await linkGuestInto(admin, guest);

    const response = await deleteAs(admin, guest.id);

    expect(response.status).toBe(400);
    expect(response.data.message).toBe('User not found.');
    expect(await userStillExists(guest.id)).toBeTrue();
    expect(await findFirstByUserId('contracts_Users', guest.id)).toBeDefined();
    await resetAuthState();
    const login = await captureRejection(Parse.User.logIn(guest.email, PASSWORD));
    expect(login).toBeNull();
  });

  it('does not let an org admin delete a guest account it linked', async () => {
    const orgAdmin = await createCaller('contracts_OrgAdmin');
    const guest = await createPlainUser(uniqueEmail('guest-org-linked'));
    await linkGuestInto(orgAdmin, guest);

    const response = await deleteAs(orgAdmin, guest.id);

    expect(response.status).toBe(400);
    expect(response.data.message).toBe('Unauthorized.');
    expect(await userStillExists(guest.id)).toBeTrue();
  });

  it('ignores a caller whose own row is flagged as a linked account', async () => {
    const linkedAdmin = await createCaller('contracts_Admin', {}, { IsLinkedAccount: true });
    const member = await createTenantMember('contracts_User', linkedAdmin);

    const response = await deleteAs(linkedAdmin, member.account.id);

    expect(response.status).toBe(400);
    expect(response.data.message).toBe('User not found.');
    expect(await userStillExists(member.account.id)).toBeTrue();
  });

  it('still deletes a member that the tenant created itself', async () => {
    const admin = await createCaller('contracts_Admin');
    const member = await createTenantMember('contracts_User', admin);

    const response = await deleteAs(admin, member.account.id);

    expect(response.status).toBe(200);
    expect(await userStillExists(member.account.id)).toBeFalse();
  });
});
