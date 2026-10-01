import {
  buildUserDetails,
  captureRejection,
  createPlainUser,
  findFirstByUserId,
  findUserByUsername,
  interceptQuery,
  pointer,
  rejectSaveFor,
  resetAuthState,
  runSignup,
  silenceConsole,
  stubFirstFor,
  stubGetFor,
  uniqueEmail,
} from '../utils/auth-fixtures.js';

const MASTER = { useMasterKey: true };

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

const findTenantOf = userId => {
  const query = new Parse.Query('partners_Tenant');
  query.equalTo('UserId', pointer('_User', userId));
  return query.first(MASTER);
};

const findOrganizationOf = extUserId => {
  const query = new Parse.Query('contracts_Organizations');
  query.equalTo('ExtUserId', pointer('contracts_Users', extUserId));
  return query.first(MASTER);
};

const signUpAdmin = async details => {
  const result = await runSignup('addadmin', details);
  const user = await findUserByUsername(details.email);
  const extUser = await findFirstByUserId('contracts_Users', user.id);
  return { result, user, extUser };
};

describe('addadmin cloud function', () => {
  beforeEach(async () => {
    silenceConsole();
    await resetAuthState();
  });

  afterEach(async () => {
    await resetAuthState();
  });

  it('returns the sign up message and a session token for a new admin', async () => {
    const { result } = await signUpAdmin(buildUserDetails({ email: uniqueEmail('admin-new') }));

    expect(result.message).toBe('User sign up');
    expect(typeof result.sessionToken).toBe('string');
  });

  it('creates the tenant with every optional address field when provided', async () => {
    const details = fullDetails({ email: uniqueEmail('admin-tenant') });

    const { user } = await signUpAdmin(details);

    const tenant = await findTenantOf(user.id);
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
    const details = fullDetails({ email: uniqueEmail('admin-ext') });

    const { user, extUser } = await signUpAdmin(details);

    const tenant = await findTenantOf(user.id);
    expect(extUser.get('Email')).toBe(details.email);
    expect(extUser.get('Name')).toBe('Test User');
    expect(extUser.get('Phone')).toBe('+5804141234567');
    expect(extUser.get('TenantId').id).toBe(tenant.id);
    expect(extUser.get('Company')).toBe('Acme');
    expect(extUser.get('JobTitle')).toBe('Engineer');
    expect(extUser.get('Timezone')).toBe('UTC');
  });

  it('omits optional fields that were not provided', async () => {
    const details = buildUserDetails({
      email: uniqueEmail('admin-min'),
      jobTitle: '',
      timezone: '',
    });

    const { user, extUser } = await signUpAdmin(details);

    const tenant = await findTenantOf(user.id);
    ['ContactNumber', 'PinCode', 'Country', 'State', 'City', 'Address'].forEach(field => {
      expect(tenant.get(field)).toBeUndefined();
    });
    ['Phone', 'JobTitle', 'Timezone'].forEach(field => {
      expect(extUser.get(field)).toBeUndefined();
    });
  });

  it('normalizes the email stored on the account, tenant and extended user', async () => {
    const rawEmail = `  Admin.Norm ${Date.now()}@Example.COM `;
    const expected = rawEmail.toLowerCase().replace(/\s/g, '');

    await runSignup('addadmin', buildUserDetails({ email: rawEmail }));

    const user = await findUserByUsername(expected);
    const tenant = await findTenantOf(user.id);
    const extUser = await findFirstByUserId('contracts_Users', user.id);
    expect(user.get('normalizedEmail')).toBe(expected);
    expect(tenant.get('EmailAddress')).toBe(expected);
    expect(extUser.get('Email')).toBe(expected);
  });

  it('creates an organization and an All Users team and links them to the admin', async () => {
    const { user, extUser } = await signUpAdmin(
      buildUserDetails({ email: uniqueEmail('admin-org'), company: 'Globex' })
    );

    const organization = await findOrganizationOf(extUser.id);
    const teamQuery = new Parse.Query('contracts_Teams');
    teamQuery.equalTo('OrganizationId', pointer('contracts_Organizations', organization.id));
    const team = await teamQuery.first(MASTER);
    const tenant = await findTenantOf(user.id);
    expect(organization.get('Name')).toBe('Globex');
    expect(organization.get('IsActive')).toBeTrue();
    expect(organization.get('CreatedBy').id).toBe(user.id);
    expect(organization.get('TenantId').id).toBe(tenant.id);
    expect(team.get('Name')).toBe('All Users');
    expect(team.get('IsActive')).toBeTrue();
    expect(extUser.get('OrganizationId').id).toBe(organization.id);
    expect(extUser.get('TeamIds').map(entry => entry.id)).toEqual([team.id]);
  });

  describe('input validation before account creation', () => {
    const signUp = userDetails => captureRejection(runSignup('addadmin', userDetails));

    const expectRejectedWithoutAccount = async (details, message) => {
      const error = await signUp(details);

      expect(error.code).toBe(Parse.Error.VALIDATION_ERROR);
      expect(error.message).toBe(message);
      expect(await findUserByUsername(details.email)).toBeUndefined();
    };

    it('stores the contracts_Admin role for an allowed request', async () => {
      const { extUser } = await signUpAdmin(buildUserDetails({ email: uniqueEmail('admin-role') }));

      expect(extUser.get('UserRole')).toBe('contracts_Admin');
    });

    [
      undefined,
      null,
      '',
      'contracts_User',
      'contracts_OrgAdmin',
      'contracts_Editor',
      'certificates_Admin',
      'Admin',
      '__proto__',
      42,
      ['contracts_Admin'],
    ].forEach(role => {
      it(`rejects the role ${JSON.stringify(role) ?? 'undefined'} without creating an account`, async () => {
        const details = buildUserDetails({ email: uniqueEmail('admin-bad-role'), role });

        await expectRejectedWithoutAccount(details, 'Invalid role.');
      });
    });

    ['name', 'email', 'password', 'company'].forEach(field => {
      [undefined, null, '', '   ', 42].forEach(value => {
        it(`rejects ${field} = ${JSON.stringify(value) ?? 'undefined'}`, async () => {
          const email = uniqueEmail('admin-required');
          const details = buildUserDetails({ email, [field]: value });

          const error = await signUp(details);

          expect(error.code).toBe(Parse.Error.VALIDATION_ERROR);
          expect(error.message).toBe(`Missing or invalid required fields: ${field}.`);
          expect(await findUserByUsername(email)).toBeUndefined();
        });
      });
    });

    ['plainaddress', 'no-tld@example', '@example.com', 'two@@example.com'].forEach(email => {
      it(`rejects the malformed email ${email}`, async () => {
        await expectRejectedWithoutAccount(buildUserDetails({ email }), 'Invalid email address.');
      });
    });

    [undefined, null, 'text', 42, []].forEach(userDetails => {
      it(`rejects userDetails = ${JSON.stringify(userDetails) ?? 'undefined'}`, async () => {
        const error = await signUp(userDetails);

        expect(error.code).toBe(Parse.Error.VALIDATION_ERROR);
        expect(error.message).toBe('Please provide user details.');
      });
    });
  });

  it('rejects with USERNAME_TAKEN when the email is already registered', async () => {
    const account = await createPlainUser(uniqueEmail('admin-taken'));

    const error = await captureRejection(
      runSignup('addadmin', buildUserDetails({ email: account.email }))
    );

    expect(error.code).toBe(Parse.Error.USERNAME_TAKEN);
    expect(await findTenantOf(account.id)).toBeUndefined();
  });

  it('still signs the admin up when creating the organization fails', async () => {
    rejectSaveFor('contracts_Organizations', new Error('org save failed'));

    const { result, extUser } = await signUpAdmin(
      buildUserDetails({ email: uniqueEmail('admin-org-fail') })
    );

    expect(result.message).toBe('User sign up');
    expect(extUser.get('OrganizationId')).toBeUndefined();
  });

  it('propagates a failure while saving the tenant', async () => {
    rejectSaveFor('partners_Tenant', new Parse.Error(141, 'tenant save failed'));
    const details = buildUserDetails({ email: uniqueEmail('admin-tenant-fail') });

    const error = await captureRejection(runSignup('addadmin', details));

    expect(error.message).toBe('tenant save failed');
  });

  it('propagates a failure while saving the extended user', async () => {
    rejectSaveFor('contracts_Users', new Parse.Error(141, 'ext save failed'));
    const details = buildUserDetails({ email: uniqueEmail('admin-ext-fail') });

    const error = await captureRejection(runSignup('addadmin', details));

    expect(error.message).toBe('ext save failed');
  });

  describe('defensive branches (unreachable via public API)', () => {
    it('answers that the user already exists when an extended user is already linked', async () => {
      const lookup = stubFirstFor('contracts_Users', { id: 'existing-ext-user' });
      const details = buildUserDetails({ email: uniqueEmail('admin-linked') });

      const result = await runSignup('addadmin', details);

      const user = await findUserByUsername(details.email);
      expect(result).toEqual({ message: 'User already exist' });
      expect(lookup.hits()).toBe(1);
      expect(await findTenantOf(user.id)).toBeUndefined();
    });

    it('does not create another organization when the extended user already has one', async () => {
      const lookup = interceptQuery('get', 'contracts_Users', async callOriginal => {
        const record = await callOriginal();
        spyOn(record, 'get').and.callFake(key =>
          key === 'OrganizationId' ? pointer('contracts_Organizations', 'preexisting') : undefined
        );
        return record;
      });

      const { result, extUser } = await signUpAdmin(
        buildUserDetails({ email: uniqueEmail('admin-has-org') })
      );

      expect(result.message).toBe('User sign up');
      expect(lookup.hits()).toBe(1);
      expect(await findOrganizationOf(extUser.id)).toBeUndefined();
      expect(extUser.get('OrganizationId')).toBeUndefined();
    });

    it('skips the organization setup when the extended user cannot be fetched', async () => {
      const lookup = stubGetFor('contracts_Users', undefined);

      const { result, extUser } = await signUpAdmin(
        buildUserDetails({ email: uniqueEmail('admin-no-fetch') })
      );

      expect(result.message).toBe('User sign up');
      expect(lookup.hits()).toBe(1);
      expect(await findOrganizationOf(extUser.id)).toBeUndefined();
    });
  });

  it('rejects a missing email without creating a tenant or an extended user', async () => {
    const details = buildUserDetails();
    delete details.email;
    const tenantsBefore = await new Parse.Query('partners_Tenant').count(MASTER);
    const extUsersBefore = await new Parse.Query('contracts_Users').count(MASTER);

    const error = await captureRejection(runSignup('addadmin', details));

    expect(error.code).toBe(Parse.Error.VALIDATION_ERROR);
    expect(error.message).toBe('Missing or invalid required fields: email.');
    expect(await new Parse.Query('partners_Tenant').count(MASTER)).toBe(tenantsBefore);
    expect(await new Parse.Query('contracts_Users').count(MASTER)).toBe(extUsersBefore);
  });
});
