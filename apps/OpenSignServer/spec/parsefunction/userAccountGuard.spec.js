import axios from 'axios';
import {
  PASSWORD,
  createPlainUser,
  findUserByUsername,
  resetAuthState,
  silenceConsole,
  uniqueEmail,
} from '../utils/auth-fixtures.js';

const MASTER = { useMasterKey: true };

const putUser = (account, data) =>
  axios.put(`${process.env.SERVER_URL}/users/${account.id}`, data, {
    headers: {
      'X-Parse-Application-Id': process.env.APP_ID,
      'X-Parse-Javascript-Key': 'test',
      'X-Parse-Session-Token': account.sessionToken,
    },
    validateStatus: () => true,
  });

const readUser = id => new Parse.Query(Parse.User).get(id, MASTER);

describe('_User account guard', () => {
  beforeEach(async () => {
    silenceConsole();
    await resetAuthState();
  });

  afterEach(async () => {
    await resetAuthState();
  });

  it('rejects a user changing its own email, username or normalizedEmail', async () => {
    const account = await createPlainUser(uniqueEmail('identity'));

    for (const change of [
      { email: uniqueEmail('hijack') },
      { username: uniqueEmail('hijack') },
      { normalizedEmail: uniqueEmail('hijack') },
    ]) {
      const response = await putUser(account, change);
      expect(response.status).withContext(JSON.stringify(change)).toBeGreaterThanOrEqual(400);
    }

    const stored = await readUser(account.id);
    expect(stored.get('email')).toBe(account.email);
    expect(stored.get('username')).toBe(account.email);
  });

  it('keeps the original credentials usable after a rejected change', async () => {
    const account = await createPlainUser(uniqueEmail('credentials'));
    await putUser(account, { email: uniqueEmail('hijack') });

    await resetAuthState();
    const login = await Parse.User.logIn(account.email, PASSWORD);

    expect(login.id).toBe(account.id);
  });

  it('lets a user update its profile fields and resend the same email', async () => {
    const account = await createPlainUser(uniqueEmail('profile'));

    const response = await putUser(account, {
      name: 'Renamed',
      phone: '+5804141234567',
      email: account.email,
    });

    const stored = await readUser(account.id);
    expect(response.status).toBe(200);
    expect(stored.get('name')).toBe('Renamed');
    expect(stored.get('phone')).toBe('+5804141234567');
  });

  it('still lets the master key change the identity fields', async () => {
    const account = await createPlainUser(uniqueEmail('master-identity'));
    const user = await readUser(account.id);
    const replacement = uniqueEmail('replacement');

    await user.save({ email: replacement }, MASTER);

    expect((await readUser(account.id)).get('email')).toBe(replacement);
  });

  it('still lets a new account be created', async () => {
    const email = uniqueEmail('signup');

    const account = await createPlainUser(email);

    expect(account.id).toBeDefined();
    expect(await findUserByUsername(email)).toBeDefined();
  });

  it('still lets the master key mark an email as verified', async () => {
    const account = await createPlainUser(uniqueEmail('verified'));
    const user = await readUser(account.id);

    await user.save({ emailVerified: true }, MASTER);

    expect((await readUser(account.id)).get('emailVerified')).toBeTrue();
  });

  it('rejects another user trying to change the email of an account', async () => {
    const victim = await createPlainUser(uniqueEmail('victim'));
    const attacker = await createPlainUser(uniqueEmail('attacker'));

    const response = await putUser(
      { id: victim.id, sessionToken: attacker.sessionToken },
      { email: uniqueEmail('hijack') }
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect((await readUser(victim.id)).get('email')).toBe(victim.email);
  });
});
