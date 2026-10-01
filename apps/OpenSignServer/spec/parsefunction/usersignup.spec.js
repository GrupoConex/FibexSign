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

const signupDetails = (overrides = {}) =>
  buildUserDetails({ role: 'contracts_User', ...overrides });

const fullDetails = overrides =>
  signupDetails({
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
    expect(extUser.get('UserRole')).toBe('contracts_User');
    expect(extUser.get('Email')).toBe(details.email);
    expect(extUser.get('Name')).toBe('Test User');
    expect(extUser.get('Phone')).toBe('+5804141234567');
    expect(extUser.get('TenantId').id).toBe(tenant.id);
    expect(extUser.get('Company')).toBe('Acme');
    expect(extUser.get('JobTitle')).toBe('Engineer');
    expect(extUser.get('Timezone')).toBe('UTC');
  });

  it('returns a usable session token for the new user', async () => {
    const details = signupDetails({ email: uniqueEmail('signup-token') });

    const result = await Parse.Cloud.run('usersignup', { userDetails: details });

    const me = await Parse.User.become(result.sessionToken);
    expect(me.get('username')).toBe(details.email);
  });

  it('omits optional fields that were not provided', async () => {
    const details = signupDetails({
      email: uniqueEmail('signup-min'),
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
    ['Phone', 'JobTitle', 'Timezone'].forEach(field => {
      expect(extUser.get(field)).toBeUndefined();
    });
  });

  it('normalizes the email stored on the tenant and extended user', async () => {
    const rawEmail = `  Signup.Norm ${Date.now()}@Example.COM `;
    const expected = rawEmail.toLowerCase().replace(/\s/g, '');

    await Parse.Cloud.run('usersignup', { userDetails: signupDetails({ email: rawEmail }) });

    const user = await findUserByUsername(expected);
    const tenant = await findTenantOf(user.id);
    const extUser = await findFirstByUserId('contracts_Users', user.id);
    expect(tenant.get('EmailAddress')).toBe(expected);
    expect(extUser.get('Email')).toBe(expected);
  });

  it('stores the extended user in the contracts class for the allowed role', async () => {
    const details = signupDetails({ email: uniqueEmail('signup-role') });

    const result = await Parse.Cloud.run('usersignup', { userDetails: details });

    const user = await findUserByUsername(details.email);
    const extUser = await findFirstByUserId('contracts_Users', user.id);
    expect(result.message).toBe('User sign up');
    expect(extUser.get('UserRole')).toBe('contracts_User');
  });

  it('rejects with USERNAME_TAKEN and creates no tenant when the email is already registered', async () => {
    const account = await createPlainUser(uniqueEmail('signup-taken'));

    const error = await captureRejection(
      Parse.Cloud.run('usersignup', { userDetails: signupDetails({ email: account.email }) })
    );

    expect(error.code).toBe(Parse.Error.USERNAME_TAKEN);
    expect(await findTenantOf(account.id)).toBeUndefined();
  });

  describe('input validation before account creation', () => {
    const signUp = userDetails => captureRejection(Parse.Cloud.run('usersignup', { userDetails }));

    const expectRejectedWithoutAccount = async (details, message) => {
      const error = await signUp(details);

      expect(error.code).toBe(Parse.Error.VALIDATION_ERROR);
      expect(error.message).toBe(message);
      expect(await findUserByUsername(details.email)).toBeUndefined();
    };

    ['name', 'email', 'password', 'company'].forEach(field => {
      [undefined, null, '', '   ', 42, {}].forEach(value => {
        it(`rejects ${field} = ${JSON.stringify(value) ?? 'undefined'} without creating an account`, async () => {
          const email = uniqueEmail('signup-required');
          const details = signupDetails({ email, [field]: value });

          const error = await signUp(details);

          expect(error.code).toBe(Parse.Error.VALIDATION_ERROR);
          expect(error.message).toBe(`Missing or invalid required fields: ${field}.`);
          expect(await findUserByUsername(email)).toBeUndefined();
          expect(await findUserByUsername(details.email)).toBeUndefined();
        });
      });
    });

    it('lists every missing required field in the message', async () => {
      const error = await signUp(
        signupDetails({ email: undefined, name: '', password: undefined, company: undefined })
      );

      expect(error.code).toBe(Parse.Error.VALIDATION_ERROR);
      expect(error.message).toBe(
        'Missing or invalid required fields: name, email, password, company.'
      );
    });

    [
      'plainaddress',
      'missing-at.example.com',
      'two@@example.com',
      'no-tld@example',
      '@example.com',
    ].forEach(email => {
      it(`rejects the malformed email ${email}`, async () => {
        await expectRejectedWithoutAccount(signupDetails({ email }), 'Invalid email address.');
      });
    });

    it('accepts an email surrounded by whitespace and uppercase characters', async () => {
      const email = `  Valid.${Date.now()}@Example.COM `;

      const result = await Parse.Cloud.run('usersignup', { userDetails: signupDetails({ email }) });

      expect(result.message).toBe('User sign up');
    });

    [
      undefined,
      null,
      '',
      'contracts_Admin',
      'contracts_OrgAdmin',
      'contracts_Editor',
      'certificates_Admin',
      'partners_User',
      'User',
      '__proto__',
      42,
      ['contracts_User'],
    ].forEach(role => {
      it(`rejects the role ${JSON.stringify(role) ?? 'undefined'} without creating an account or tenant`, async () => {
        const details = signupDetails({ email: uniqueEmail('signup-role-invalid'), role });

        await expectRejectedWithoutAccount(details, 'Invalid role.');
      });
    });

    [undefined, null, 'text', 42, []].forEach(userDetails => {
      it(`rejects userDetails = ${JSON.stringify(userDetails) ?? 'undefined'}`, async () => {
        const error = await signUp(userDetails);

        expect(error.code).toBe(Parse.Error.VALIDATION_ERROR);
        expect(error.message).toBe('Please provide user details.');
      });
    });

    it('does not query or create anything when validation fails', async () => {
      const createSpy = spyOn(Parse.User.prototype, 'signUp').and.callThrough();

      await signUp(signupDetails({ role: undefined, email: uniqueEmail('signup-no-io') }));

      expect(createSpy).not.toHaveBeenCalled();
    });
  });

  it('propagates a failure while saving the tenant', async () => {
    rejectSaveFor('partners_Tenant', new Parse.Error(141, 'tenant save failed'));
    const details = signupDetails({ email: uniqueEmail('signup-tenant-fail') });

    const error = await captureRejection(Parse.Cloud.run('usersignup', { userDetails: details }));

    expect(error.message).toBe('tenant save failed');
  });

  it('propagates a failure while saving the extended user', async () => {
    rejectSaveFor('contracts_Users', new Parse.Error(141, 'ext save failed'));
    const details = signupDetails({ email: uniqueEmail('signup-ext-fail') });

    const error = await captureRejection(Parse.Cloud.run('usersignup', { userDetails: details }));

    expect(error.message).toBe('ext save failed');
  });

  describe('defensive branches (unreachable via public API)', () => {
    it('answers that the user already exists when an extended user is already linked', async () => {
      const lookup = stubFirstFor('contracts_Users', { id: 'existing-ext-user' });
      const details = signupDetails({ email: uniqueEmail('signup-linked') });

      const result = await Parse.Cloud.run('usersignup', { userDetails: details });

      const user = await findUserByUsername(details.email);
      expect(result).toEqual({ message: 'User already exist' });
      expect(lookup.hits()).toBe(1);
      expect(await findTenantOf(user.id)).toBeUndefined();
    });
  });
});
