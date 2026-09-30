import {
  captureRejection,
  cloudRunAs,
  createCaller,
  createOrganization,
  createTeam,
  createTenant,
  createTenantScope,
  rejectFirstFor,
  resetAuthState,
  silenceConsole,
  uniqueEmail,
} from '../utils/auth-fixtures.js';

const UNAUTHORIZED = 'Unauthorized.';

const buildParams = (caller, overrides = {}) => ({
  name: 'New Member',
  email: uniqueEmail('member'),
  password: 'Member-Passw0rd!',
  organization: { objectId: caller.organization.id, company: 'Acme' },
  team: caller.team.id,
  role: 'Editor',
  tenantId: caller.tenant.id,
  ...overrides,
});

const runAddUser = (caller, overrides) =>
  captureRejection(
    cloudRunAs('adduser', buildParams(caller, overrides), caller.account.sessionToken)
  );

describe('adduser cloud function authorization', () => {
  beforeEach(async () => {
    silenceConsole();
    await resetAuthState();
  });

  it('rejects unauthenticated callers with INVALID_SESSION_TOKEN', async () => {
    const caller = await createCaller('contracts_Admin');

    const error = await captureRejection(cloudRunAs('adduser', buildParams(caller)));

    expect(error.code).toBe(Parse.Error.INVALID_SESSION_TOKEN);
    expect(error.message).toBe('Invalid session token.');
  });

  ['name', 'email', 'password', 'organization', 'team', 'role', 'tenantId'].forEach(field => {
    it(`rejects with a required fields error when ${field} is missing`, async () => {
      const caller = await createCaller('contracts_Admin');

      const error = await runAddUser(caller, { [field]: undefined });

      expect(error.code).toBe(400);
      expect(error.message).toBe('Please provide all required fields.');
    });
  });

  it('rejects with User not found when the caller extended user is missing', async () => {
    const caller = await createCaller('contracts_Admin');
    await caller.extUser.destroy({ useMasterKey: true });

    const error = await runAddUser(caller);

    expect(error.code).toBe(400);
    expect(error.message).toBe('User not found.');
  });

  it('rejects with User not found when the caller extended user is disabled', async () => {
    const caller = await createCaller('contracts_Admin', {}, { IsDisabled: true });

    const error = await runAddUser(caller);

    expect(error.message).toBe('User not found.');
  });

  ['contracts_User', 'contracts_Editor'].forEach(role => {
    it(`rejects callers whose role is ${role}`, async () => {
      const caller = await createCaller(role);

      const error = await runAddUser(caller);

      expect(error.message).toBe(UNAUTHORIZED);
    });
  });

  it('rejects when the caller extended user has no tenant', async () => {
    const caller = await createCaller('contracts_Admin', { tenant: undefined });

    const error = await runAddUser(caller);

    expect(error.message).toBe(UNAUTHORIZED);
  });

  it('rejects when the supplied tenant differs from the caller tenant', async () => {
    const caller = await createCaller('contracts_Admin');
    const foreignTenant = await createTenant('Foreign');

    const error = await runAddUser(caller, { tenantId: foreignTenant.id });

    expect(error.message).toBe(UNAUTHORIZED);
  });

  it('rejects an org admin caller that has no organization', async () => {
    const caller = await createCaller('contracts_OrgAdmin', { organization: undefined });

    const error = await runAddUser(caller);

    expect(error.message).toBe(UNAUTHORIZED);
  });

  ['Admin', 'contracts_Admin', 'Owner', 'editor'].forEach(role => {
    it(`rejects the disallowed role ${role}`, async () => {
      const caller = await createCaller('contracts_Admin');

      const error = await runAddUser(caller, { role });

      expect(error.code).toBe(400);
      expect(error.message).toBe('Invalid role.');
    });
  });

  it('rejects an organization payload without an objectId', async () => {
    const caller = await createCaller('contracts_Admin');

    const error = await runAddUser(caller, { organization: { company: 'Acme' } });

    expect(error.message).toBe('Please provide all required fields.');
  });

  it('rejects an organization that does not exist', async () => {
    const caller = await createCaller('contracts_Admin');

    const error = await runAddUser(caller, { organization: { objectId: 'doesNotExist' } });

    expect(error.message).toBe('Object not found.');
  });

  it('rejects an organization that belongs to another tenant', async () => {
    const caller = await createCaller('contracts_Admin');
    const foreignOrganization = await createOrganization(await createTenant('Foreign'));

    const error = await runAddUser(caller, { organization: { objectId: foreignOrganization.id } });

    expect(error.message).toBe(UNAUTHORIZED);
  });

  it('rejects an organization that has no tenant', async () => {
    const caller = await createCaller('contracts_Admin');
    const orphanOrganization = new Parse.Object('contracts_Organizations');
    await orphanOrganization.save({ Name: 'Orphan' }, { useMasterKey: true });

    const error = await runAddUser(caller, { organization: { objectId: orphanOrganization.id } });

    expect(error.message).toBe(UNAUTHORIZED);
  });

  it('rejects an org admin adding users to a different organization of the same tenant', async () => {
    const caller = await createCaller('contracts_OrgAdmin');
    const siblingOrganization = await createOrganization(caller.tenant, 'Sibling');
    const siblingTeam = await createTeam(siblingOrganization);

    const error = await runAddUser(caller, {
      organization: { objectId: siblingOrganization.id },
      team: siblingTeam.id,
    });

    expect(error.message).toBe(UNAUTHORIZED);
  });

  it('rejects a team that belongs to a different organization', async () => {
    const caller = await createCaller('contracts_Admin');
    const otherScope = await createTenantScope();

    const error = await runAddUser(caller, { team: otherScope.team.id });

    expect(error.message).toBe(UNAUTHORIZED);
  });

  it('rejects a team that has no organization', async () => {
    const caller = await createCaller('contracts_Admin');
    const orphanTeam = new Parse.Object('contracts_Teams');
    await orphanTeam.save({ Name: 'Orphan Team' }, { useMasterKey: true });

    const error = await runAddUser(caller, { team: orphanTeam.id });

    expect(error.message).toBe(UNAUTHORIZED);
  });

  it('rejects a team that does not exist', async () => {
    const caller = await createCaller('contracts_Admin');

    const error = await runAddUser(caller, { team: 'doesNotExist' });

    expect(error.message).toBe('Object not found.');
  });

  it('falls back to a generic message when the caller lookup fails without details', async () => {
    const caller = await createCaller('contracts_Admin');
    const callerLookup = rejectFirstFor('contracts_Users', {});

    const error = await runAddUser(caller);

    expect(error.code).toBe(400);
    expect(error.message).toBe('something went wrong');
    expect(callerLookup.hits()).toBe(1);
  });
});
