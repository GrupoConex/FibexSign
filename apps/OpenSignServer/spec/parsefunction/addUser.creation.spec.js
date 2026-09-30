import { knownDefect } from '../utils/known-defect.js';
import {
  PASSWORD,
  captureRejection,
  cloudRunAs,
  createCaller,
  createPlainUser,
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

  it('lets the new member log in with the supplied password', async () => {
    const caller = await createCaller('contracts_Admin');
    const params = buildParams(caller);

    await addUserAs(caller, params);
    await resetAuthState();

    const loggedIn = await Parse.User.logIn(params.email, MEMBER_PASSWORD);
    expect(loggedIn.get('username')).toBe(params.email);
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

  it(
    'does not echo the plaintext password in the response',
    knownDefect(
      'SEC-04',
      'addUser returns the new account with its plaintext password embedded in response.UserId',
      async check => {
        const caller = await createCaller('contracts_Admin');
        const params = buildParams(caller);

        const result = await addUserAs(caller, params);

        check(
          !JSON.stringify(result).includes(MEMBER_PASSWORD),
          'the response must not contain the password'
        );
      }
    )
  );

  it(
    'does not overwrite the password of an account that belongs to another tenant',
    knownDefect(
      'SEC-05',
      'addUser resets the password of any pre-existing account matched by email, including accounts of other tenants',
      async check => {
        const caller = await createCaller('contracts_Admin');
        const victim = await createCaller('contracts_Admin');

        await captureRejection(
          addUserAs(
            caller,
            buildParams(caller, { email: victim.account.email, password: 'Attacker-Passw0rd!' })
          )
        );

        await resetAuthState();
        const victimLogin = await captureRejection(
          Parse.User.logIn(victim.account.email, PASSWORD)
        );
        check(victimLogin === null, 'the victim must still log in with the original password');
      }
    )
  );

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

  it(
    'rejects with a domain error when the username is taken by an account registered with another email',
    knownDefect(
      'DEF-04',
      'addUser leaks a raw TypeError message when the taken username belongs to an account with a different email',
      async check => {
        const caller = await createCaller('contracts_Admin');
        const account = await createPlainUser(uniqueEmail('username-only'));
        const stored = await findUserByUsername(account.email);
        await stored.save({ email: uniqueEmail('other-email') }, { useMasterKey: true });

        const error = await captureRejection(
          addUserAs(caller, buildParams(caller, { email: account.email }))
        );

        check(error?.code === 400, 'must reject with code 400');
        check(
          !String(error?.message).startsWith('Cannot read properties'),
          'message must be a domain error, not a TypeError'
        );
      }
    )
  );

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
