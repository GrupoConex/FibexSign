import { knownDefect } from '../utils/known-defect.js';
import {
  buildUserDetails,
  captureRejection,
  createPlainUser,
  findFirstByUserId,
  findUserByUsername,
  rejectSaveFor,
  resetAuthState,
  silenceConsole,
  stubFirstFor,
  uniqueEmail,
} from '../utils/auth-fixtures.js';

const fullDetails = overrides =>
  buildUserDetails({
    phone: '+5804141234567',
    pincode: '1010',
    country: 'VE',
    state: 'Miranda',
    city: 'Caracas',
    address: 'Av. Principal 1',
    ...overrides,
  });

const findTenantOf = async userId => {
  const query = new Parse.Query('partners_Tenant');
  query.equalTo('UserId', { __type: 'Pointer', className: '_User', objectId: userId });
  return query.first({ useMasterKey: true });
};

describe('usersignup cloud function', () => {
  beforeEach(async () => {
    silenceConsole();
    await resetAuthState();
  });

  afterEach(async () => {
    await resetAuthState();
  });

  it('creates the tenant with every optional address field when provided', async () => {
    const details = fullDetails({ email: uniqueEmail('signup-full') });

    const result = await Parse.Cloud.run('usersignup', { userDetails: details });

    const user = await findUserByUsername(details.email);
    const tenant = await findTenantOf(user.id);
    expect(result.message).toBe('User sign up');
    expect(tenant.get('TenantName')).toBe('Acme');
    expect(tenant.get('EmailAddress')).toBe(details.email);
    expect(tenant.get('IsActive')).toBeTrue();
    expect(tenant.get('ContactNumber')).toBe('+5804141234567');
    expect(tenant.get('PinCode')).toBe('1010');
    expect(tenant.get('Country')).toBe('VE');
    expect(tenant.get('State')).toBe('Miranda');
    expect(tenant.get('City')).toBe('Caracas');
    expect(tenant.get('Address')).toBe('Av. Principal 1');
    expect(tenant.get('CreatedBy').id).toBe(user.id);
  });

  it('creates the extended user with every optional field when provided', async () => {
    const details = fullDetails({ email: uniqueEmail('signup-ext') });

    await Parse.Cloud.run('usersignup', { userDetails: details });

    const user = await findUserByUsername(details.email);
    const tenant = await findTenantOf(user.id);
    const extUser = await findFirstByUserId('contracts_Users', user.id);
    expect(extUser.get('UserRole')).toBe('contracts_Admin');
    expect(extUser.get('Email')).toBe(details.email);
    expect(extUser.get('Name')).toBe('Test User');
    expect(extUser.get('Phone')).toBe('+5804141234567');
    expect(extUser.get('TenantId').id).toBe(tenant.id);
    expect(extUser.get('Company')).toBe('Acme');
    expect(extUser.get('JobTitle')).toBe('Engineer');
    expect(extUser.get('Timezone')).toBe('UTC');
  });

  it('returns a usable session token for the new user', async () => {
    const details = buildUserDetails({ email: uniqueEmail('signup-token') });

    const result = await Parse.Cloud.run('usersignup', { userDetails: details });

    const me = await Parse.User.become(result.sessionToken);
    expect(me.get('username')).toBe(details.email);
  });

  it('omits optional fields that were not provided', async () => {
    const details = buildUserDetails({
      email: uniqueEmail('signup-min'),
      company: '',
      jobTitle: '',
      timezone: '',
    });

    await Parse.Cloud.run('usersignup', { userDetails: details });

    const user = await findUserByUsername(details.email);
    const tenant = await findTenantOf(user.id);
    const extUser = await findFirstByUserId('contracts_Users', user.id);
    ['ContactNumber', 'PinCode', 'Country', 'State', 'City', 'Address'].forEach(field => {
      expect(tenant.get(field)).toBeUndefined();
    });
    ['Phone', 'Company', 'JobTitle', 'Timezone'].forEach(field => {
      expect(extUser.get(field)).toBeUndefined();
    });
  });

  it('normalizes the email stored on the tenant and extended user', async () => {
    const rawEmail = `  Signup.Norm ${Date.now()}@Example.COM `;
    const expected = rawEmail.toLowerCase().replace(/\s/g, '');

    await Parse.Cloud.run('usersignup', { userDetails: buildUserDetails({ email: rawEmail }) });

    const user = await findUserByUsername(expected);
    const tenant = await findTenantOf(user.id);
    const extUser = await findFirstByUserId('contracts_Users', user.id);
    expect(tenant.get('EmailAddress')).toBe(expected);
    expect(extUser.get('Email')).toBe(expected);
  });

  it('stores the extended user in the class derived from the role prefix', async () => {
    const details = buildUserDetails({
      email: uniqueEmail('signup-role'),
      role: 'certificates_Admin',
    });

    const result = await Parse.Cloud.run('usersignup', { userDetails: details });

    const user = await findUserByUsername(details.email);
    const extUser = await findFirstByUserId('certificates_Users', user.id);
    expect(result.message).toBe('User sign up');
    expect(extUser.get('UserRole')).toBe('certificates_Admin');
  });

  it('rejects with USERNAME_TAKEN and creates no tenant when the email is already registered', async () => {
    const account = await createPlainUser(uniqueEmail('signup-taken'));

    const error = await captureRejection(
      Parse.Cloud.run('usersignup', { userDetails: buildUserDetails({ email: account.email }) })
    );

    expect(error.code).toBe(Parse.Error.USERNAME_TAKEN);
    expect(await findTenantOf(account.id)).toBeUndefined();
  });

  it('rejects when the role is missing without creating a tenant or an extended user', async () => {
    const details = buildUserDetails({ email: uniqueEmail('signup-norole'), role: undefined });

    const error = await captureRejection(Parse.Cloud.run('usersignup', { userDetails: details }));

    const user = await findUserByUsername(details.email);
    expect(error.code).toBe(Parse.Error.SCRIPT_FAILED);
    expect(error.message).toContain("reading 'split'");
    expect(await findTenantOf(user.id)).toBeUndefined();
    expect(await findFirstByUserId('contracts_Users', user.id)).toBeUndefined();
  });

  it(
    'does not leave an orphan account behind when the role is missing',
    knownDefect(
      'SEC-07',
      'usersignup validates the role after creating the account, leaving an orphan _User when the role is missing',
      async check => {
        const details = buildUserDetails({ email: uniqueEmail('signup-orphan'), role: undefined });

        await captureRejection(Parse.Cloud.run('usersignup', { userDetails: details }));

        check(
          (await findUserByUsername(details.email)) === undefined,
          'no _User may remain after a rejected signup'
        );
      }
    )
  );

  it('propagates a failure while saving the tenant', async () => {
    rejectSaveFor('partners_Tenant', new Parse.Error(141, 'tenant save failed'));
    const details = buildUserDetails({ email: uniqueEmail('signup-tenant-fail') });

    const error = await captureRejection(Parse.Cloud.run('usersignup', { userDetails: details }));

    expect(error.message).toBe('tenant save failed');
  });

  it('propagates a failure while saving the extended user', async () => {
    rejectSaveFor('contracts_Users', new Parse.Error(141, 'ext save failed'));
    const details = buildUserDetails({ email: uniqueEmail('signup-ext-fail') });

    const error = await captureRejection(Parse.Cloud.run('usersignup', { userDetails: details }));

    expect(error.message).toBe('ext save failed');
  });

  describe('defensive branches (unreachable via public API)', () => {
    it('answers that the user already exists when an extended user is already linked', async () => {
      const lookup = stubFirstFor('contracts_Users', { id: 'existing-ext-user' });
      const details = buildUserDetails({ email: uniqueEmail('signup-linked') });

      const result = await Parse.Cloud.run('usersignup', { userDetails: details });

      const user = await findUserByUsername(details.email);
      expect(result).toEqual({ message: 'User already exist' });
      expect(lookup.hits()).toBe(1);
      expect(await findTenantOf(user.id)).toBeUndefined();
    });
  });
});
