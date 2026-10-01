import { runSignup } from './utils/auth-fixtures.js';

describe('signup endpoints do not allow passwordless account takeover', () => {
  Parse.User.enableUnsafeCurrentUser();

  it('addadmin does not mint a session for an existing user given a wrong password', async () => {
    const email = `addadmin-victim-${Date.now()}@example.com`;
    const validDetails = {
      email,
      password: 'correct-horse-battery-staple',
      name: 'Victim User',
      company: 'Acme',
      jobTitle: 'Engineer',
      role: 'contracts_Admin',
      timezone: 'UTC',
    };

    await runSignup('addadmin', validDetails);

    const expectedNormalizedEmail = email.toLowerCase().replace(/\s/g, '');
    const createdUserQuery = new Parse.Query(Parse.User);
    createdUserQuery.equalTo('normalizedEmail', expectedNormalizedEmail);
    const createdUser = await createdUserQuery.first({ useMasterKey: true });

    expect(createdUser).toBeDefined();
    expect(createdUser.get('normalizedEmail')).toBe(expectedNormalizedEmail);

    let thrown = null;
    let result = null;
    try {
      result = await runSignup('addadmin', {
        ...validDetails,
        password: 'totally-different-wrong-password',
      });
      fail('addadmin should have thrown for an existing user instead of returning a result.');
    } catch (err) {
      thrown = err;
    }

    expect(thrown).not.toBeNull();
    expect(thrown.code).toBe(Parse.Error.USERNAME_TAKEN);
    expect(result).toBeNull();
    expect(JSON.stringify(result ?? {})).not.toContain('sessionToken');
  });

  it('usersignup does not mint a session for an existing user who resubmits the signup with a different password', async () => {
    const email = `usersignup-victim-${Date.now()}@example.com`;
    const firstDetails = {
      email,
      password: 'correct-horse-battery-staple',
      name: 'Victim User',
      company: 'Acme',
      jobTitle: 'Engineer',
      role: 'contracts_User',
      timezone: 'UTC',
    };

    await runSignup('usersignup', firstDetails);

    let thrown = null;
    let result = null;
    try {
      result = await runSignup('usersignup', {
        ...firstDetails,
        password: 'totally-different-wrong-password',
      });
      fail('usersignup should have thrown for an existing user instead of returning a result.');
    } catch (err) {
      thrown = err;
    }

    expect(thrown).not.toBeNull();
    expect(thrown.code).toBe(Parse.Error.USERNAME_TAKEN);
    expect(result).toBeNull();
    expect(JSON.stringify(result ?? {})).not.toContain('sessionToken');
  });

  it('usersignup succeeds for a genuinely new user and persists a normalizedEmail', async () => {
    const rawEmail = `New.User.${Date.now()}@Example.com`;
    const expectedNormalizedEmail = rawEmail.toLowerCase().replace(/\s/g, '');
    const newUserDetails = {
      email: rawEmail,
      password: 'another-strong-password',
      name: 'Brand New User',
      company: 'Acme',
      jobTitle: 'Engineer',
      role: 'contracts_User',
      timezone: 'UTC',
    };

    const result = await runSignup('usersignup', newUserDetails);

    expect(result).toBeDefined();
    expect(result.message).toBe('User sign up');
    expect(result.sessionToken).toBeDefined();
    expect(typeof result.sessionToken).toBe('string');

    const userQuery = new Parse.Query(Parse.User);
    userQuery.equalTo('normalizedEmail', expectedNormalizedEmail);
    const savedUser = await userQuery.first({ useMasterKey: true });

    expect(savedUser).toBeDefined();
    expect(savedUser.get('normalizedEmail')).toBe(expectedNormalizedEmail);
  });
});
