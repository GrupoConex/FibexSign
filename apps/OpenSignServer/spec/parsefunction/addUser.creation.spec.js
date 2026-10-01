import {
  PASSWORD,
  captureRejection,
  cloudRunAs,
  createCaller,
  createPlainUser,
  createTenantMember,
  findFirstByUserId,
  findUserByUsername,
  rejectSaveFor,
  resetAuthState,
  silenceConsole,
  uniqueEmail,
} from '../utils/auth-fixtures.js';

const MEMBER_PASSWORD = 'Member-Passw0rd!';

const buildParams = (caller, overrides = {}) => ({
  name: 'New Member',
  email: uniqueEmail('member'),
  password: MEMBER_PASSWORD,
  organization: { objectId: caller.organization.id, company: 'Acme' },
  team: caller.team.id,
  role: 'Editor',
  tenantId: caller.tenant.id,
  ...overrides,
});

const idOf = reference => reference.id || reference.objectId;

const countExtUsers = userId => {
  const query = new Parse.Query('contracts_Users');
  query.equalTo('UserId', { __type: 'Pointer', className: '_User', objectId: userId });
  return query.count({ useMasterKey: true });
};

const addUserAs = (caller, params) => cloudRunAs('adduser', params, caller.account.sessionToken);

describe('adduser cloud function creation', () => {
  beforeEach(async () => {
    silenceConsole();
    await resetAuthState();
  });

  afterEach(async () => {
    await resetAuthState();
  });

  it('creates the account and extended user with every optional field for an admin caller', async () => {
    const caller = await createCaller('contracts_Admin');
    const params = buildParams(caller, { phone: '+5804141234567', timezone: 'America/Caracas' });

    const result = await addUserAs(caller, params);

    const account = await findUserByUsername(params.email);
    expect(result.Name).toBe('New Member');
    expect(result.Email).toBe(params.email);
    expect(result.UserRole).toBe('contracts_Editor');
    expect(result.Phone).toBe('+5804141234567');
    expect(result.Timezone).toBe('America/Caracas');
    expect(result.Company).toBe('Acme');
    expect(idOf(result.TenantId)).toBe(caller.tenant.id);
    expect(idOf(result.OrganizationId)).toBe(caller.organization.id);
    expect(idOf(result.TeamIds[0])).toBe(caller.team.id);
    expect(idOf(result.CreatedBy)).toBe(caller.account.id);
    expect(idOf(result.UserId)).toBe(account.id);
    expect(account.get('name')).toBe('New Member');
    expect(account.get('phone')).toBe('+5804141234567');
  });

  it('omits phone, timezone and company when they are not provided', async () => {
    const caller = await createCaller('contracts_Admin');
    const params = buildParams(caller, { organization: { objectId: caller.organization.id } });

    const result = await addUserAs(caller, params);

    const account = await findUserByUsername(params.email);
    expect(result.Phone).toBeUndefined();
    expect(result.Timezone).toBeUndefined();
    expect(result.Company).toBeUndefined();
    expect(account.get('phone')).toBeUndefined();
  });

  it('normalizes the email of the new member', async () => {
    const caller = await createCaller('contracts_Admin');
    const rawEmail = `  New.Member ${Date.now()}@Example.COM `;
    const expected = rawEmail.toLowerCase().replace(/\s/g, '');

    const result = await addUserAs(caller, buildParams(caller, { email: rawEmail }));

    const account = await findUserByUsername(expected);
    expect(result.Email).toBe(expected);
    expect(account.get('email')).toBe(expected);
  });

  ['OrgAdmin', 'Editor', 'User'].forEach(role => {
    it(`stores the ${role} role with the contracts_ prefix`, async () => {
      const caller = await createCaller('contracts_Admin');

      const result = await addUserAs(caller, buildParams(caller, { role }));

      expect(result.UserRole).toBe(`contracts_${role}`);
    });
  });

  it('lets an org admin add a member to its own organization', async () => {
    const caller = await createCaller('contracts_OrgAdmin');

    const result = await addUserAs(caller, buildParams(caller));

    expect(idOf(result.OrganizationId)).toBe(caller.organization.id);
    expect(result.UserRole).toBe('contracts_Editor');
  });

  it('grants read and write access to both the caller and the new member only', async () => {
    const caller = await createCaller('contracts_Admin');
    const params = buildParams(caller);

    const result = await addUserAs(caller, params);

    const account = await findUserByUsername(params.email);
    const stored = await findFirstByUserId('contracts_Users', account.id);
    const acl = stored.getACL();
    expect(stored.id).toBe(result.objectId);
    expect(acl.getReadAccess(caller.account.id)).toBeTrue();
    expect(acl.getWriteAccess(caller.account.id)).toBeTrue();
    expect(acl.getReadAccess(account.id)).toBeTrue();
    expect(acl.getWriteAccess(account.id)).toBeTrue();
    expect(acl.getPublicReadAccess()).toBeFalse();
    expect(acl.getPublicWriteAccess()).toBeFalse();
  });

  it('stores the supplied password for the new member', async () => {
    const caller = await createCaller('contracts_Admin');
    const params = buildParams(caller);

    await addUserAs(caller, params);
    await resetAuthState();

    const verified = await Parse.User.verifyPassword(params.email, MEMBER_PASSWORD);
    expect(verified.username).toBe(params.email);
  });

  it('links an already registered account to the new extended user', async () => {
    const caller = await createCaller('contracts_Admin');
    const existing = await createPlainUser(uniqueEmail('existing'));

    const result = await addUserAs(caller, buildParams(caller, { email: existing.email }));

    const stored = await findFirstByUserId('contracts_Users', existing.id);
    const acl = stored.getACL();
    expect(idOf(result.UserId)).toBe(existing.id);
    expect(idOf(result.CreatedBy)).toBe(caller.account.id);
    expect(stored.id).toBe(result.objectId);
    expect(acl.getReadAccess(existing.id)).toBeTrue();
    expect(acl.getWriteAccess(caller.account.id)).toBeTrue();
  });

  it('does not echo the plaintext password or account credentials in the response', async () => {
    const caller = await createCaller('contracts_Admin');
    const params = buildParams(caller);

    const result = await addUserAs(caller, params);

    const account = await findUserByUsername(params.email);
    expect(JSON.stringify(result)).not.toContain(MEMBER_PASSWORD);
    expect(result.UserId.className).toBe('_User');
    expect(result.UserId.id).toBe(account.id);
    expect(result.UserId.attributes).toEqual({});
  });

  it('returns the linked account as a plain pointer without credentials', async () => {
    const caller = await createCaller('contracts_Admin');
    const orphan = await createPlainUser(uniqueEmail('orphan-response'));

    const result = await addUserAs(caller, buildParams(caller, { email: orphan.email }));

    expect(JSON.stringify(result)).not.toContain(MEMBER_PASSWORD);
    expect(result.UserId.className).toBe('_User');
    expect(result.UserId.id).toBe(orphan.id);
    expect(result.UserId.attributes).toEqual({});
  });

  it('locks the old password of an orphan account out without adopting the supplied one', async () => {
    const caller = await createCaller('contracts_Admin');
    const orphan = await createPlainUser(uniqueEmail('orphan-password'));

    await addUserAs(caller, buildParams(caller, { email: orphan.email }));

    await resetAuthState();
    const originalLogin = await captureRejection(Parse.User.logIn(orphan.email, PASSWORD));
    expect(originalLogin.code).toBe(Parse.Error.OBJECT_NOT_FOUND);
    await resetAuthState();
    const suppliedLogin = await captureRejection(Parse.User.logIn(orphan.email, MEMBER_PASSWORD));
    expect(suppliedLogin.code).toBe(Parse.Error.OBJECT_NOT_FOUND);
  });

  it('flags the extended user of a linked account as not tenant managed and says so in the response', async () => {
    const caller = await createCaller('contracts_Admin');
    const orphan = await createPlainUser(uniqueEmail('orphan-flag'));

    const result = await addUserAs(caller, buildParams(caller, { email: orphan.email }));

    const linked = await findFirstByUserId('contracts_Users', orphan.id);
    expect(result.linkedExistingAccount).toBeTrue();
    expect(result.IsLinkedAccount).toBeTrue();
    expect(linked.get('IsLinkedAccount')).toBeTrue();
  });

  it('does not flag or announce anything for an account created by the call', async () => {
    const caller = await createCaller('contracts_Admin');
    const params = buildParams(caller);

    const result = await addUserAs(caller, params);

    const account = await findUserByUsername(params.email);
    const created = await findFirstByUserId('contracts_Users', account.id);
    expect(result.linkedExistingAccount).toBeUndefined();
    expect(result.IsLinkedAccount).toBeUndefined();
    expect(created.get('IsLinkedAccount')).toBeUndefined();
  });

  it('links an orphan account inside the tenant of the caller', async () => {
    const caller = await createCaller('contracts_Admin');
    const orphan = await createPlainUser(uniqueEmail('orphan-tenant'));

    await addUserAs(caller, buildParams(caller, { email: orphan.email }));

    const linked = await findFirstByUserId('contracts_Users', orphan.id);
    expect(idOf(linked.get('TenantId'))).toBe(caller.tenant.id);
    expect(idOf(linked.get('OrganizationId'))).toBe(caller.organization.id);
  });

  it('rejects an email that already belongs to an account of another tenant without touching it', async () => {
    const caller = await createCaller('contracts_Admin');
    const victim = await createCaller('contracts_Admin');

    const error = await captureRejection(
      addUserAs(
        caller,
        buildParams(caller, { email: victim.account.email, password: 'Attacker-Passw0rd!' })
      )
    );

    await resetAuthState();
    const victimLogin = await captureRejection(
      Parse.User.verifyPassword(victim.account.email, PASSWORD)
    );
    expect(error.code).toBe(Parse.Error.DUPLICATE_VALUE);
    expect(error.message).toBe('An account with this email already exists.');
    expect(victimLogin).toBeNull();
  });

  it('rejects an email that already belongs to a member of the same tenant', async () => {
    const caller = await createCaller('contracts_Admin');
    const member = await createTenantMember('contracts_User', caller);

    const error = await captureRejection(
      addUserAs(caller, buildParams(caller, { email: member.account.email }))
    );

    expect(error.code).toBe(Parse.Error.DUPLICATE_VALUE);
    expect(await countExtUsers(member.account.id)).toBe(1);
  });

  it('rejects an account that only has a disabled extended user', async () => {
    const caller = await createCaller('contracts_Admin');
    const disabled = await createTenantMember('contracts_User', {
      ...caller,
      extras: { IsDisabled: true },
    });

    const error = await captureRejection(
      addUserAs(caller, buildParams(caller, { email: disabled.account.email }))
    );

    expect(error.code).toBe(Parse.Error.DUPLICATE_VALUE);
  });

  it('rejects when the email is already used by an account with a different username', async () => {
    const caller = await createCaller('contracts_Admin');
    const account = await createPlainUser(uniqueEmail('username-a'));
    const clashingEmail = uniqueEmail('clash');
    const clashing = await findUserByUsername(account.email);
    await clashing.save({ email: clashingEmail }, { useMasterKey: true });

    const error = await captureRejection(
      addUserAs(caller, buildParams(caller, { email: clashingEmail }))
    );

    expect(error.code).toBe(400);
    expect(error.message).toBe('Account already exists for this email address.');
  });

  it('rejects with a domain error when the username is taken by an account registered with another email', async () => {
    const caller = await createCaller('contracts_Admin');
    const account = await createPlainUser(uniqueEmail('username-only'));
    const stored = await findUserByUsername(account.email);
    await stored.save({ email: uniqueEmail('other-email') }, { useMasterKey: true });

    const error = await captureRejection(
      addUserAs(caller, buildParams(caller, { email: account.email }))
    );

    expect(error.code).toBe(Parse.Error.DUPLICATE_VALUE);
    expect(error.message).toBe('An account with this email already exists.');
    expect(await countExtUsers(account.id)).toBe(0);
  });

  it('falls back to a generic message when the account save fails without details', async () => {
    const caller = await createCaller('contracts_Admin');
    rejectSaveFor('_User', {});

    const error = await captureRejection(addUserAs(caller, buildParams(caller)));

    expect(error.code).toBe(400);
    expect(error.message).toBe('something went wrong');
  });

  it('propagates a failure while saving the extended user', async () => {
    const caller = await createCaller('contracts_Admin');
    rejectSaveFor('contracts_Users', new Error('ext save failed'));

    const error = await captureRejection(addUserAs(caller, buildParams(caller)));

    expect(error.code).toBe(400);
    expect(error.message).toBe('ext save failed');
  });

  describe('defensive branches (unreachable via public API)', () => {
    it('returns nothing and creates no extended user when the account save yields no user', async () => {
      const caller = await createCaller('contracts_Admin');
      const params = buildParams(caller);
      const userSave = spyOn(Parse.User.prototype, 'save').and.resolveTo(undefined);

      const result = await addUserAs(caller, params);

      expect(result).toBeUndefined();
      expect(userSave).toHaveBeenCalledTimes(1);
      expect(await findUserByUsername(params.email)).toBeUndefined();
    });
  });
});
