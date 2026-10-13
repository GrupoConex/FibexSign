import { deleteAsAdmin, stubSessionLookup } from '../utils/delete-account-fixtures.js';
import {
  captureRejection,
  cloudRunAs,
  createCaller,
  createExtUser,
  createPlainUser,
  createTenantScope,
  pointer,
  resetAuthState,
  silenceConsole,
  uniqueEmail,
} from '../utils/auth-fixtures.js';

const MASTER = { useMasterKey: true };

const addGuestAs = (admin, guest, overrides = {}) =>
  cloudRunAs(
    'adduser',
    {
      name: 'Returning Guest',
      email: guest.email,
      password: 'Returning-Passw0rd!',
      organization: { objectId: admin.organization.id },
      team: admin.team.id,
      role: 'User',
      tenantId: admin.tenant.id,
      ...overrides,
    },
    admin.account.sessionToken
  );

const profilesOf = guest =>
  new Parse.Query('contracts_Users').equalTo('UserId', pointer('_User', guest.id)).findAll(MASTER);

const reloadRow = objectId => new Parse.Query('contracts_Users').get(objectId, MASTER);

const linkAndRemove = async admin => {
  const guest = await createPlainUser(uniqueEmail('guest-returning'));
  const linked = await addGuestAs(admin, guest);
  await deleteAsAdmin(admin.account.sessionToken, guest.id);
  return { guest, linkedId: linked.objectId };
};

describe('adduser with a guest removed from the organization', () => {
  beforeEach(async () => {
    silenceConsole();
    spyOn(console, 'error');
    stubSessionLookup();
    await resetAuthState();
  });

  afterEach(async () => {
    await resetAuthState();
  });

  it('reactivates the removed linked profile instead of creating another one', async () => {
    const admin = await createCaller('contracts_Admin');
    const { guest, linkedId } = await linkAndRemove(admin);

    const result = await addGuestAs(admin, guest, { role: 'Editor', name: 'Back Again' });

    const row = await reloadRow(linkedId);
    expect(result.objectId).toBe(linkedId);
    expect(result.linkedExistingAccount).toBeTrue();
    expect(row.get('IsDisabled')).toBeFalse();
    expect(row.get('RemovedFromOrgAt')).toBeUndefined();
    expect(row.get('UserRole')).toBe('contracts_Editor');
    expect(row.get('Name')).toBe('Back Again');
    expect(row.get('CreatedBy').id).toBe(admin.account.id);
    expect(row.getACL().getReadAccess(guest.id)).toBeTrue();
    expect((await profilesOf(guest)).length).toBe(1);
  });

  it('reactivates the removed profile of a guest that also has a home tenant', async () => {
    const admin = await createCaller('contracts_Admin');
    const { guest, linkedId } = await linkAndRemove(admin);
    const home = await createTenantScope();
    await createExtUser({ account: guest, role: 'contracts_Admin', ...home });

    const result = await addGuestAs(admin, guest);

    expect(result.objectId).toBe(linkedId);
    expect((await reloadRow(linkedId)).get('RemovedFromOrgAt')).toBeUndefined();
  });

  it('lets another tenant link a guest whose only profile was removed', async () => {
    const admin = await createCaller('contracts_Admin');
    const otherTenant = await createCaller('contracts_Admin');
    const { guest, linkedId } = await linkAndRemove(admin);

    const result = await addGuestAs(otherTenant, guest);

    expect(result.objectId).not.toBe(linkedId);
    expect(result.linkedExistingAccount).toBeTrue();
    expect((await reloadRow(linkedId)).get('RemovedFromOrgAt')).toEqual(jasmine.any(Date));
  });

  it('still refuses a guest whose profile in the tenant is only deactivated', async () => {
    const admin = await createCaller('contracts_Admin');
    const guest = await createPlainUser(uniqueEmail('guest-deactivated'));
    const linked = await addGuestAs(admin, guest);
    await (await reloadRow(linked.objectId)).save({ IsDisabled: true }, MASTER);

    const failure = await captureRejection(addGuestAs(admin, guest));

    expect(failure.code).toBe(Parse.Error.DUPLICATE_VALUE);
    expect((await profilesOf(guest)).length).toBe(1);
  });
});
