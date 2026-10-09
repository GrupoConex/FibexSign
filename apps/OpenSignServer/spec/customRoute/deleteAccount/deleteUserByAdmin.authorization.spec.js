import axios from 'axios';
import {
  accountExists,
  deleteAsAdmin,
  stubSessionLookup,
} from '../../utils/delete-account-fixtures.js';
import {
  createCaller,
  createExtUser,
  createPlainUser,
  createTenantMember,
  createTenantScope,
  pointer,
  resetAuthState,
  silenceConsole,
  uniqueEmail,
} from '../../utils/auth-fixtures.js';
import { knownDefect } from '../../utils/known-defect.js';

const ROUTE_ROOT = 'http://localhost:30001';
const MASTER = { useMasterKey: true };

const expectRefusal = (response, message) => {
  expect(response.status).toBe(400);
  expect(response.data.message).toBe(message);
};

describe('deleteuser route authorization', () => {
  beforeEach(async () => {
    silenceConsole();
    spyOn(console, 'error');
    stubSessionLookup();
    await resetAuthState();
  });

  it('requires a session token', async () => {
    const response = await axios.post(`${ROUTE_ROOT}/deleteuser/someUser123`, null, {
      validateStatus: () => true,
    });

    expectRefusal(response, 'Unauthorized.');
  });

  it('rejects the unresolved route placeholder as user id', async () => {
    const admin = await createCaller('contracts_Admin');

    const response = await deleteAsAdmin(admin.account.sessionToken, ':userId');

    expectRefusal(response, 'Missing userId parameter.');
  });

  it('rejects a session token the server does not recognize', async () => {
    const response = await deleteAsAdmin('r:not-a-session', 'someUser123');

    expect(response.status).toBe(400);
    expect(response.data.message).toBe('Invalid session token');
  });

  it('rejects a session whose user id cannot be resolved', async () => {
    axios.get.and.resolveTo({ data: {} });

    const response = await deleteAsAdmin('r:any', 'someUser123');

    expectRefusal(response, 'Unauthorized.');
  });

  it('reports a transport failure without a response body', async () => {
    axios.get.and.rejectWith(new Error('socket hang up'));

    const response = await deleteAsAdmin('r:any', 'someUser123');

    expectRefusal(response, 'socket hang up');
  });

  it('reports a generic failure when the error carries no detail', async () => {
    axios.get.and.rejectWith({});

    const response = await deleteAsAdmin('r:any', 'someUser123');

    expectRefusal(response, 'An error occurred while deleting your account.');
  });

  it('refuses a target that does not exist', async () => {
    const admin = await createCaller('contracts_Admin');

    const response = await deleteAsAdmin(admin.account.sessionToken, 'missingUser1');

    expectRefusal(response, 'User not found.');
  });

  it('refuses to delete the caller own account', async () => {
    const admin = await createCaller('contracts_Admin');

    const response = await deleteAsAdmin(admin.account.sessionToken, admin.account.id);

    expectRefusal(response, 'You cannot delete your own account.');
    expect(await accountExists(admin.account.id)).toBeTrue();
  });

  it('refuses a caller that has no tenant profile', async () => {
    const outsider = await createPlainUser(uniqueEmail('outsider'));
    const member = await createCaller('contracts_User');

    const response = await deleteAsAdmin(outsider.sessionToken, member.account.id);

    expectRefusal(response, 'User not found.');
    expect(await accountExists(member.account.id)).toBeTrue();
  });

  it('refuses a caller whose role is not an administrator', async () => {
    const scope = await createCaller('contracts_Admin');
    const caller = await createTenantMember('contracts_User', scope);
    const victim = await createTenantMember('contracts_User', scope);

    const response = await deleteAsAdmin(caller.account.sessionToken, victim.account.id);

    expectRefusal(response, 'Unauthorized.');
    expect(await accountExists(victim.account.id)).toBeTrue();
  });

  it('lets a tenant admin delete a member of its tenant', async () => {
    const admin = await createCaller('contracts_Admin');
    const member = await createTenantMember('contracts_User', admin);

    const response = await deleteAsAdmin(admin.account.sessionToken, member.account.id);

    expect(response.status).toBe(200);
    expect(await accountExists(member.account.id)).toBeFalse();
  });

  it('keeps members of another tenant out of reach of a tenant admin', async () => {
    const admin = await createCaller('contracts_Admin');
    const foreign = await createCaller('contracts_User');

    const response = await deleteAsAdmin(admin.account.sessionToken, foreign.account.id);

    expectRefusal(response, 'User not found.');
    expect(await accountExists(foreign.account.id)).toBeTrue();
  });

  it('refuses to delete another tenant admin', async () => {
    const scope = await createCaller('contracts_Admin');
    const secondAdmin = await createTenantMember('contracts_Admin', scope);

    const response = await deleteAsAdmin(scope.account.sessionToken, secondAdmin.account.id);

    expectRefusal(response, 'An error occurred while deleting your account.');
    expect(await accountExists(secondAdmin.account.id)).toBeTrue();
  });

  it('lets an admin without a tenant delete only the users it created', async () => {
    const account = await createPlainUser(uniqueEmail('tenantless-admin'));
    await createExtUser({ account, role: 'contracts_Admin' });
    const created = await createPlainUser(uniqueEmail('created'));
    const unrelated = await createPlainUser(uniqueEmail('unrelated'));
    await createExtUser({
      account: created,
      role: 'contracts_User',
      extras: { CreatedBy: pointer('_User', account.id) },
    });
    await createExtUser({ account: unrelated, role: 'contracts_User' });

    const refused = await deleteAsAdmin(account.sessionToken, unrelated.id);
    const allowed = await deleteAsAdmin(account.sessionToken, created.id);

    expectRefusal(refused, 'User not found.');
    expect(allowed.status).toBe(200);
    expect(await accountExists(unrelated.id)).toBeTrue();
  });
});

describe('deleteuser route organization admins', () => {
  beforeEach(async () => {
    silenceConsole();
    spyOn(console, 'error');
    stubSessionLookup();
    await resetAuthState();
  });

  it('lets an org admin delete a member of its organization', async () => {
    const orgAdmin = await createCaller('contracts_OrgAdmin');
    const member = await createTenantMember('contracts_User', orgAdmin);

    const response = await deleteAsAdmin(orgAdmin.account.sessionToken, member.account.id);

    expect(response.status).toBe(200);
    expect(await accountExists(member.account.id)).toBeFalse();
  });

  it('keeps members of a sibling organization out of reach', async () => {
    const orgAdmin = await createCaller('contracts_OrgAdmin');
    const siblingScope = await createTenantScope();
    const sibling = await createTenantMember('contracts_User', {
      ...siblingScope,
      tenant: orgAdmin.tenant,
    });

    const response = await deleteAsAdmin(orgAdmin.account.sessionToken, sibling.account.id);

    expectRefusal(response, 'Unauthorized.');
    expect(await accountExists(sibling.account.id)).toBeTrue();
  });

  it('refuses to delete a tenant admin', async () => {
    const orgAdmin = await createCaller('contracts_OrgAdmin');
    const tenantAdmin = await createTenantMember('contracts_Admin', orgAdmin);

    const response = await deleteAsAdmin(orgAdmin.account.sessionToken, tenantAdmin.account.id);

    expectRefusal(response, 'Unauthorized.');
    expect(await accountExists(tenantAdmin.account.id)).toBeTrue();
  });

  it('gives no tenant wide reach to an org admin that has no organization', async () => {
    const orgAdmin = await createCaller('contracts_OrgAdmin');
    orgAdmin.extUser.unset('OrganizationId');
    await orgAdmin.extUser.save(null, MASTER);
    const member = await createTenantMember('contracts_User', orgAdmin);

    const response = await deleteAsAdmin(orgAdmin.account.sessionToken, member.account.id);

    expectRefusal(response, 'Unauthorized.');
    expect(await accountExists(member.account.id)).toBeTrue();
  });

  it(
    'KNOWN DEFECT DEF-L2-01 refuses an org admin deleting a peer org admin',
    knownDefect(
      'DEF-L2-01',
      'an org admin can delete another org admin of the same organization',
      async check => {
        const orgAdmin = await createCaller('contracts_OrgAdmin');
        const peer = await createTenantMember('contracts_OrgAdmin', orgAdmin);

        await deleteAsAdmin(orgAdmin.account.sessionToken, peer.account.id);

        check(await accountExists(peer.account.id), 'peer org admin survives');
      }
    )
  );
});
