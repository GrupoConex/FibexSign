import getUserDetails from '../../cloud/parsefunction/getUserDetails.js';
import {
  captureRejection,
  cloudRunAs,
  createCaller,
  createExtUser,
  createPlainUser,
  rejectFirstFor,
  resetAuthState,
  silenceConsole,
  uniqueEmail,
} from '../utils/auth-fixtures.js';

const MASTER = { useMasterKey: true };

const attachSensitiveTenantFields = async tenant => {
  tenant.set('FileAdapters', 'sensitive-adapter-config');
  tenant.set('PfxFile', { name: 'certificate.pfx' });
  await tenant.save(null, MASTER);
};

describe('getUserDetails cloud function', () => {
  beforeEach(async () => {
    silenceConsole();
    await resetAuthState();
  });

  afterEach(async () => {
    await resetAuthState();
  });

  it('rejects with INVALID_SESSION_TOKEN when neither an email nor a session is provided', async () => {
    const error = await captureRejection(Parse.Cloud.run('getUserDetails', {}));

    expect(error.code).toBe(Parse.Error.INVALID_SESSION_TOKEN);
    expect(error.message).toBe('User is not authenticated.');
  });

  it('reports exists true for a known email without requiring a session', async () => {
    const caller = await createCaller('contracts_Admin');

    const result = await Parse.Cloud.run('getUserDetails', { email: caller.account.email });

    expect(result).toEqual({ exists: true });
  });

  it('reports exists false for an unknown email', async () => {
    const result = await Parse.Cloud.run('getUserDetails', { email: uniqueEmail('unknown') });

    expect(result).toEqual({ exists: false });
  });

  it('prefers the supplied email over the session user', async () => {
    const caller = await createCaller('contracts_Admin');

    const result = await cloudRunAs(
      'getUserDetails',
      { email: uniqueEmail('someone-else') },
      caller.account.sessionToken
    );

    expect(result).toEqual({ exists: false });
  });

  it('returns the extended user of the session user when no email is supplied', async () => {
    const caller = await createCaller('contracts_Admin');

    const result = await cloudRunAs('getUserDetails', {}, caller.account.sessionToken);

    expect(result.id).toBe(caller.extUser.id);
    expect(result.get('UserRole')).toBe('contracts_Admin');
    expect(result.get('TenantId').id).toBe(caller.tenant.id);
    expect(result.get('UserId').id).toBe(caller.account.id);
  });

  it('includes the tenant and user pointers of the extended user', async () => {
    const caller = await createCaller('contracts_Admin');

    const result = await cloudRunAs('getUserDetails', {}, caller.account.sessionToken);

    expect(result.get('TenantId').get('TenantName')).toBe('Tenant');
    expect(result.get('UserId').get('username')).toBe(caller.account.email);
  });

  it('returns an empty string when the session user has no extended user', async () => {
    const account = await createPlainUser(uniqueEmail('no-ext'));

    const result = await cloudRunAs('getUserDetails', {}, account.sessionToken);

    expect(result).toBe('');
  });

  it('does not expose sensitive tenant or user fields', async () => {
    const caller = await createCaller('contracts_Admin');
    await attachSensitiveTenantFields(caller.tenant);
    caller.extUser.set('google_refresh_token', 'refresh-secret');
    await caller.extUser.save(null, MASTER);

    const storedTenant = await new Parse.Query('partners_Tenant').get(caller.tenant.id, MASTER);
    expect(storedTenant.get('PfxFile')).toBeDefined();

    const result = await cloudRunAs('getUserDetails', {}, caller.account.sessionToken);

    expect(result.get('google_refresh_token')).toBeUndefined();
    expect(result.get('TenantId').get('FileAdapters')).toBeUndefined();
    expect(result.get('TenantId').get('PfxFile')).toBeUndefined();
  });

  it('matches by creator when a userId filter is supplied with an email', async () => {
    const account = await createPlainUser(uniqueEmail('created-by'));
    const creator = await createPlainUser(uniqueEmail('creator'));
    await createExtUser({
      account,
      role: 'contracts_User',
      extras: { CreatedBy: { __type: 'Pointer', className: '_User', objectId: creator.id } },
    });

    const matching = await Parse.Cloud.run('getUserDetails', {
      email: account.email,
      userId: creator.id,
    });
    const mismatching = await Parse.Cloud.run('getUserDetails', {
      email: account.email,
      userId: account.id,
    });

    expect(matching).toEqual({ exists: true });
    expect(mismatching).toEqual({ exists: false });
  });

  it('applies the userId filter to the session user lookup', async () => {
    const caller = await createCaller('contracts_Admin');

    const filtered = await cloudRunAs(
      'getUserDetails',
      { userId: 'someoneElse' },
      caller.account.sessionToken
    );

    expect(filtered).toBe('');
  });

  it('rethrows a parse error carrying the original code and message when the query fails', async () => {
    const lookup = rejectFirstFor('contracts_Users', { code: 141, message: 'db exploded' });

    const error = await captureRejection(getUserDetails({ params: { email: 'a@b.co' } }));

    expect(error.code).toBe(141);
    expect(error.message).toBe('db exploded');
    expect(lookup.hits()).toBe(1);
  });

  it('falls back to code 400 and a generic message when the failure has no details', async () => {
    const lookup = rejectFirstFor('contracts_Users', {});

    const error = await captureRejection(getUserDetails({ params: { email: 'a@b.co' } }));

    expect(error.code).toBe(400);
    expect(error.message).toBe('Something went wrong.');
    expect(lookup.hits()).toBe(1);
  });

  it('falls back to code 400 when the failure is nullish', async () => {
    const lookup = rejectFirstFor('contracts_Users', undefined);

    const error = await captureRejection(getUserDetails({ params: { email: 'a@b.co' } }));

    expect(error.code).toBe(400);
    expect(error.message).toBe('Something went wrong.');
    expect(lookup.hits()).toBe(1);
  });
});
