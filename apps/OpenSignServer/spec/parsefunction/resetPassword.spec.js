import { knownDefect } from '../utils/known-defect.js';
import {
  PASSWORD,
  captureConsoleError,
  captureRejection,
  cloudRunAs,
  createCaller,
  createExtUser,
  createOrganization,
  createPlainUser,
  createTeam,
  createTenantMember,
  createTenantScope,
  rejectSaveFor,
  resetAuthState,
  silenceConsole,
  uniqueEmail,
} from '../utils/auth-fixtures.js';

const NEW_PASSWORD = 'Brand-New-Passw0rd!';

const resetAs = (caller, params) =>
  captureRejection(cloudRunAs('resetpassword', params, caller.account.sessionToken));

const canLogIn = async (email, password) => {
  await resetAuthState();
  const error = await captureRejection(Parse.User.logIn(email, password));
  await resetAuthState();
  return error === null;
};

describe('resetpassword cloud function', () => {
  let consoleError;

  beforeEach(async () => {
    silenceConsole();
    consoleError = captureConsoleError();
    await resetAuthState();
  });

  afterEach(async () => {
    await resetAuthState();
  });

  it('rejects when the target user id is missing', async () => {
    const caller = await createCaller('contracts_Admin');

    const error = await resetAs(caller, { password: NEW_PASSWORD });

    expect(error.code).toBe(Parse.Error.INVALID_QUERY);
    expect(error.message).toBe('Please provide required parameters.');
  });

  it('rejects when the new password is missing', async () => {
    const caller = await createCaller('contracts_Admin');

    const error = await resetAs(caller, { userId: 'someone' });

    expect(error.code).toBe(Parse.Error.INVALID_QUERY);
    expect(error.message).toBe('Please provide required parameters.');
  });

  it('rejects unauthenticated callers with INVALID_SESSION_TOKEN', async () => {
    const error = await captureRejection(
      Parse.Cloud.run('resetpassword', { userId: 'someone', password: NEW_PASSWORD })
    );

    expect(error.code).toBe(Parse.Error.INVALID_SESSION_TOKEN);
    expect(error.message).toBe('User is not authenticated.');
  });

  it('rejects a caller resetting its own password', async () => {
    const caller = await createCaller('contracts_Admin');

    const error = await resetAs(caller, { userId: caller.account.id, password: NEW_PASSWORD });

    expect(error.code).toBe(Parse.Error.INVALID_QUERY);
    expect(error.message).toBe('Unauthorized to reset your own password.');
  });

  it('rejects a caller that has no extended user', async () => {
    const outsider = { account: await createPlainUser(uniqueEmail('outsider')) };

    const error = await resetAs(outsider, { userId: 'someone', password: NEW_PASSWORD });

    expect(error.code).toBe(Parse.Error.OBJECT_NOT_FOUND);
    expect(error.message).toBe('Admin user tenant not found.');
  });

  it('rejects a caller whose extended user has no tenant', async () => {
    const caller = await createCaller('contracts_Admin', { tenant: undefined });

    const error = await resetAs(caller, { userId: 'someone', password: NEW_PASSWORD });

    expect(error.code).toBe(Parse.Error.OBJECT_NOT_FOUND);
    expect(error.message).toBe('Admin user tenant not found.');
  });

  ['contracts_User', 'contracts_Editor'].forEach(role => {
    it(`rejects callers whose role is ${role}`, async () => {
      const caller = await createCaller(role);
      const target = await createTenantMember('contracts_User', caller);

      const error = await resetAs(caller, { userId: target.account.id, password: NEW_PASSWORD });

      expect(error.code).toBe(Parse.Error.INVALID_QUERY);
      expect(error.message).toBe('Unauthorized.');
    });
  });

  it('lets an admin reset the password of a member of the same tenant', async () => {
    const caller = await createCaller('contracts_Admin');
    const target = await createTenantMember('contracts_User', caller);

    const result = await cloudRunAs(
      'resetpassword',
      { userId: target.account.id, password: NEW_PASSWORD },
      caller.account.sessionToken
    );

    expect(result).toEqual({ status: 'success', message: 'Password has been reset.' });
    expect(await canLogIn(target.account.email, NEW_PASSWORD)).toBeTrue();
    expect(await canLogIn(target.account.email, PASSWORD)).toBeFalse();
  });

  it('lets an org admin reset the password of a member of the same organization', async () => {
    const caller = await createCaller('contracts_OrgAdmin');
    const target = await createTenantMember('contracts_User', caller);

    const result = await cloudRunAs(
      'resetpassword',
      { userId: target.account.id, password: NEW_PASSWORD },
      caller.account.sessionToken
    );

    expect(result.status).toBe('success');
    expect(await canLogIn(target.account.email, NEW_PASSWORD)).toBeTrue();
  });

  it('refuses to reset the password of another admin', async () => {
    const caller = await createCaller('contracts_Admin');
    const otherAdmin = await createTenantMember('contracts_Admin', caller);

    const error = await resetAs(caller, { userId: otherAdmin.account.id, password: NEW_PASSWORD });

    expect(error.code).toBe(Parse.Error.OBJECT_NOT_FOUND);
    expect(error.message).toBe('User not found or not allowed.');
    expect(await canLogIn(otherAdmin.account.email, PASSWORD)).toBeTrue();
  });

  it('refuses to reset the password of a member of another tenant', async () => {
    const caller = await createCaller('contracts_Admin');
    const foreign = await createTenantMember('contracts_User', await createTenantScope());

    const error = await resetAs(caller, { userId: foreign.account.id, password: NEW_PASSWORD });

    expect(error.message).toBe('User not found or not allowed.');
    expect(await canLogIn(foreign.account.email, PASSWORD)).toBeTrue();
  });

  it('refuses to reset the password of an unknown user id', async () => {
    const caller = await createCaller('contracts_Admin');

    const error = await resetAs(caller, { userId: 'doesNotExist', password: NEW_PASSWORD });

    expect(error.code).toBe(Parse.Error.OBJECT_NOT_FOUND);
    expect(error.message).toBe('User not found or not allowed.');
  });

  it('rejects when the extended user points to an account that no longer exists', async () => {
    const caller = await createCaller('contracts_Admin');
    await createExtUser({
      account: { id: 'ghostAccount', email: uniqueEmail('ghost') },
      role: 'contracts_User',
      tenant: caller.tenant,
    });

    const error = await resetAs(caller, { userId: 'ghostAccount', password: NEW_PASSWORD });

    expect(error.code).toBe(Parse.Error.OBJECT_NOT_FOUND);
    expect(error.message).toBe('User not found.');
  });

  it('rethrows a failure while saving the new password', async () => {
    const caller = await createCaller('contracts_Admin');
    const target = await createTenantMember('contracts_User', caller);
    rejectSaveFor('_User', new Parse.Error(141, 'password save failed'));

    const error = await resetAs(caller, { userId: target.account.id, password: NEW_PASSWORD });

    expect(error.message).toBe('password save failed');
    expect(consoleError).toHaveBeenCalledWith(
      'Error while resetting password:',
      jasmine.objectContaining({ message: 'password save failed' })
    );
    expect(await canLogIn(target.account.email, PASSWORD)).toBeTrue();
  });

  it(
    'does not let an org admin reset the password of a user in another organization',
    knownDefect(
      'SEC-06',
      'resetPassword enforces tenant scope only, so an OrgAdmin can reset users of other organizations while addUser scopes OrgAdmin by organization',
      async check => {
        const caller = await createCaller('contracts_OrgAdmin');
        const siblingOrganization = await createOrganization(caller.tenant, 'Sibling');
        const siblingTeam = await createTeam(siblingOrganization);
        const target = await createTenantMember('contracts_User', {
          tenant: caller.tenant,
          organization: siblingOrganization,
          team: siblingTeam,
        });

        const error = await resetAs(caller, { userId: target.account.id, password: NEW_PASSWORD });

        check(error !== null, 'must reject a reset outside the caller organization');
        check(
          await canLogIn(target.account.email, PASSWORD),
          'the target must keep the original password'
        );
      }
    )
  );
});
