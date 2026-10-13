import { deleteUser } from '../../cloud/customRoute/deleteAccount/deleteUserCascade.js';
import { loadCallerAccess } from '../../cloud/parsefunction/shared/sendMailv3Authorization.js';
import {
  LINKED_MEMBER_REMOVED,
  REMOVED_FROM_ORGANIZATION,
  deleteAsAdmin,
  existsRecord,
  linkGuestInto,
  openGuestSession,
  saveRows,
  sessionIdsOf,
  stubSessionLookup,
} from '../utils/delete-account-fixtures.js';
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
} from '../utils/auth-fixtures.js';

const MASTER = { useMasterKey: true };
const ADMIN_REFUSAL = 'An error occurred while deleting your account.';

const deleteAs = (admin, userId) => deleteAsAdmin(admin.account.sessionToken, userId);

const createLinkedRow = (account, scope, role = 'contracts_User', extras = {}) =>
  createExtUser({
    account,
    role,
    tenant: scope.tenant,
    organization: scope.organization,
    team: scope.team,
    extras: { IsLinkedAccount: true, ...extras },
  });

const createGuestWithHome = async () => {
  const guest = await createPlainUser(uniqueEmail('guest-linked'));
  const home = await createTenantScope();
  return { guest, home };
};

const giveGuestHomeProfile = (guest, home) =>
  createExtUser({
    account: guest,
    role: 'contracts_Admin',
    tenant: home.tenant,
    organization: home.organization,
    team: home.team,
  });

const seedGuestWork = async (guest, linkedRowId) => {
  const fields = {
    CreatedBy: pointer('_User', guest.id),
    ExtUserPtr: pointer('contracts_Users', linkedRowId),
  };
  const [document] = await saveRows('contracts_Document', [{ Name: 'Guest doc', ...fields }]);
  const [template] = await saveRows('contracts_Template', [{ Name: 'Guest tpl', ...fields }]);
  const [contact] = await saveRows('contracts_Contactbook', [
    { Name: 'Guest contact', CreatedBy: fields.CreatedBy },
  ]);
  return { document, template, contact };
};

const userStillExists = userId => existsRecord('_User', userId);

const reloadRow = objectId => new Parse.Query('contracts_Users').get(objectId, MASTER);

const expectSoftRemoved = async objectId => {
  const row = await reloadRow(objectId);
  expect(row.get('IsDisabled')).toBeTrue();
  expect(row.get('RemovedFromOrgAt')).toEqual(jasmine.any(Date));
};

const expectUntouched = async objectId => {
  const row = await reloadRow(objectId);
  expect(row.get('IsDisabled')).not.toBeTrue();
  expect(row.get('RemovedFromOrgAt')).toBeUndefined();
};

const interceptSaveAllOf = (className, failure) => {
  const original = Parse.Object.saveAll;
  return spyOn(Parse.Object, 'saveAll').and.callFake((objects, options) =>
    objects[0]?.className === className
      ? failure(original, objects, options)
      : original(objects, options)
  );
};

const vanishBeforeSave = async (original, objects, options) => {
  await Parse.Object.destroyAll(objects, options);
  return original(objects, options);
};

const expectRefusal = (response, message) => {
  expect(response.status).toBe(400);
  expect(response.data.message).toBe(message);
};

const expectRemoved = response => {
  expect(response.status).toBe(200);
  expect(response.data.message).toBe(REMOVED_FROM_ORGANIZATION);
  expect(response.data.code).toBe(LINKED_MEMBER_REMOVED);
};

describe('deleteuser route and linked accounts', () => {
  beforeEach(async () => {
    silenceConsole();
    spyOn(console, 'error');
    stubSessionLookup();
    await resetAuthState();
  });

  afterEach(async () => {
    await resetAuthState();
  });

  it('removes a linked guest from the tenant admin organization keeping its account and work', async () => {
    const admin = await createCaller('contracts_Admin');
    const { guest, home } = await createGuestWithHome();
    const linked = await linkGuestInto(admin, guest);
    const homeProfile = await giveGuestHomeProfile(guest, home);
    const work = await seedGuestWork(guest, linked.objectId);
    const guestSession = await openGuestSession(guest);
    const sessionsBefore = await sessionIdsOf(guest.id);
    expect(sessionsBefore.length).toBeGreaterThan(0);

    const response = await deleteAs(admin, guest.id);

    expectRemoved(response);
    expect(await userStillExists(guest.id)).toBeTrue();
    await expectSoftRemoved(linked.objectId);
    await expectUntouched(homeProfile.id);
    expect(await existsRecord('contracts_Document', work.document.id)).toBeTrue();
    expect(await existsRecord('contracts_Template', work.template.id)).toBeTrue();
    expect(await existsRecord('contracts_Contactbook', work.contact.id)).toBeTrue();
    expect(await sessionIdsOf(guest.id)).toEqual(sessionsBefore);
    expect((await Parse.User.become(guestSession)).id).toBe(guest.id);
    expect((await loadCallerAccess(guest.id)).tenantId).toBe(home.tenant.id);
  });

  it('removes a linked guest from the org admin organization', async () => {
    const orgAdmin = await createCaller('contracts_OrgAdmin');
    const guest = await createPlainUser(uniqueEmail('guest-org-linked'));
    const linked = await linkGuestInto(orgAdmin, guest);

    const response = await deleteAs(orgAdmin, guest.id);

    expectRemoved(response);
    expect(await userStillExists(guest.id)).toBeTrue();
    await expectSoftRemoved(linked.objectId);
  });

  it('answers a repeated removal as removed and keeps the first removal date', async () => {
    const admin = await createCaller('contracts_Admin');
    const guest = await createPlainUser(uniqueEmail('guest-twice'));
    const linked = await linkGuestInto(admin, guest);
    await deleteAs(admin, guest.id);
    const firstRemoval = (await reloadRow(linked.objectId)).get('RemovedFromOrgAt');

    const response = await deleteAs(admin, guest.id);

    expectRemoved(response);
    expect((await reloadRow(linked.objectId)).get('RemovedFromOrgAt')).toEqual(firstRemoval);
  });

  it('keeps a linked guest of a sibling organization out of reach of an org admin', async () => {
    const orgAdmin = await createCaller('contracts_OrgAdmin');
    const sibling = await createTenantScope();
    const guest = await createPlainUser(uniqueEmail('guest-sibling'));
    const linked = await createLinkedRow(guest, { ...sibling, tenant: orgAdmin.tenant });

    const response = await deleteAs(orgAdmin, guest.id);

    expectRefusal(response, 'Unauthorized.');
    await expectUntouched(linked.id);
  });

  it('does not let an org admin remove a linked tenant admin', async () => {
    const orgAdmin = await createCaller('contracts_OrgAdmin');
    const guest = await createPlainUser(uniqueEmail('guest-linked-admin'));
    const linked = await createLinkedRow(guest, orgAdmin, 'contracts_Admin');

    const response = await deleteAs(orgAdmin, guest.id);

    expectRefusal(response, 'Unauthorized.');
    await expectUntouched(linked.id);
  });

  it('does not let a tenant admin remove a linked admin', async () => {
    const admin = await createCaller('contracts_Admin');
    const guest = await createPlainUser(uniqueEmail('guest-peer-admin'));
    const linked = await createLinkedRow(guest, admin, 'contracts_Admin');

    const response = await deleteAs(admin, guest.id);

    expectRefusal(response, ADMIN_REFUSAL);
    await expectUntouched(linked.id);
  });

  it('still reports an unknown user or a guest linked only to another tenant as not found', async () => {
    const admin = await createCaller('contracts_Admin');
    const otherTenant = await createCaller('contracts_Admin');
    const guest = await createPlainUser(uniqueEmail('guest-elsewhere'));
    const linkedElsewhere = await linkGuestInto(otherTenant, guest);

    const unknown = await deleteAs(admin, 'missingUser1');
    const elsewhere = await deleteAs(admin, guest.id);

    expectRefusal(unknown, 'User not found.');
    expectRefusal(elsewhere, 'User not found.');
    await expectUntouched(linkedElsewhere.objectId);
  });

  it('lets an admin without a tenant remove only the linked profiles it created', async () => {
    const account = await createPlainUser(uniqueEmail('tenantless-admin'));
    await createExtUser({ account, role: 'contracts_Admin' });
    const tenantless = { account };
    const created = await createPlainUser(uniqueEmail('linked-created'));
    const unrelated = await createPlainUser(uniqueEmail('linked-unrelated'));
    const createdRow = await createLinkedRow(created, {}, 'contracts_User', {
      CreatedBy: pointer('_User', account.id),
    });
    const unrelatedRow = await createLinkedRow(unrelated, {});

    const refused = await deleteAs(tenantless, unrelated.id);
    const allowed = await deleteAs(tenantless, created.id);

    expectRefusal(refused, 'User not found.');
    expectRemoved(allowed);
    await expectUntouched(unrelatedRow.id);
    await expectSoftRemoved(createdRow.id);
    expect(await userStillExists(created.id)).toBeTrue();
  });

  it('reports a failure to remove the linked profile', async () => {
    const admin = await createCaller('contracts_Admin');
    const guest = await createPlainUser(uniqueEmail('guest-failure'));
    const linked = await linkGuestInto(admin, guest);
    interceptSaveAllOf('contracts_Users', () => Promise.reject(new Error('boom')));

    const response = await deleteAs(admin, guest.id);

    expectRefusal(response, 'User deletion failed: boom');
    await expectUntouched(linked.objectId);
  });

  it('removes every linked profile of the guest inside the admin scope', async () => {
    const admin = await createCaller('contracts_Admin');
    const guest = await createPlainUser(uniqueEmail('guest-duplicated'));
    const first = await createLinkedRow(guest, admin);
    const second = await createLinkedRow(guest, admin);

    const response = await deleteAs(admin, guest.id);

    expectRemoved(response);
    await expectSoftRemoved(first.id);
    await expectSoftRemoved(second.id);
  });

  it('refuses every duplicated linked profile when one of them is protected', async () => {
    const orgAdmin = await createCaller('contracts_OrgAdmin');
    const guest = await createPlainUser(uniqueEmail('guest-mixed-roles'));
    const member = await createLinkedRow(guest, orgAdmin);
    const tenantAdmin = await createLinkedRow(guest, orgAdmin, 'contracts_Admin');

    const response = await deleteAs(orgAdmin, guest.id);

    expectRefusal(response, 'Unauthorized.');
    await expectUntouched(member.id);
    await expectUntouched(tenantAdmin.id);
  });

  it('treats a linked profile that vanished concurrently as removed', async () => {
    const admin = await createCaller('contracts_Admin');
    const guest = await createPlainUser(uniqueEmail('guest-race'));
    const linked = await linkGuestInto(admin, guest);
    interceptSaveAllOf('contracts_Users', vanishBeforeSave);

    const response = await deleteAs(admin, guest.id);

    expectRemoved(response);
    expect(await existsRecord('contracts_Users', linked.objectId)).toBeFalse();
  });

  it('treats an object not found answer from the save as removed', async () => {
    const admin = await createCaller('contracts_Admin');
    const guest = await createPlainUser(uniqueEmail('guest-not-found'));
    await linkGuestInto(admin, guest);
    interceptSaveAllOf('contracts_Users', () =>
      Promise.reject(new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Object not found.'))
    );

    const response = await deleteAs(admin, guest.id);

    expectRemoved(response);
  });

  it('reports a batch failure that is not only missing profiles', async () => {
    const admin = await createCaller('contracts_Admin');
    const guest = await createPlainUser(uniqueEmail('guest-batch-failure'));
    await linkGuestInto(admin, guest);
    const batchFailure = Object.assign(new Parse.Error(Parse.Error.AGGREGATE_ERROR, 'batch'), {
      errors: [new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'gone'), new Error('locked')],
    });
    interceptSaveAllOf('contracts_Users', () => Promise.reject(batchFailure));

    const response = await deleteAs(admin, guest.id);

    expectRefusal(response, 'User deletion failed: batch');
  });

  it('never removes linked profiles when no administrator is acting', async () => {
    const admin = await createCaller('contracts_Admin');
    const guest = await createPlainUser(uniqueEmail('guest-self'));
    const linked = await linkGuestInto(admin, guest);

    const outcome = await deleteUser(guest.id);

    expect(outcome).toEqual({ code: 400, message: 'User not found.' });
    await expectUntouched(linked.objectId);
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
