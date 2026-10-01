import createUserAccount from '../../cloud/parsefunction/shared/createUserAccount.js';
import {
  PASSWORD,
  buildUserDetails,
  captureRejection,
  createPlainUser,
  findUserByUsername,
  resetAuthState,
  silenceConsole,
  uniqueEmail,
} from '../utils/auth-fixtures.js';

describe('createUserAccount shared helper', () => {
  beforeEach(async () => {
    silenceConsole();
    await resetAuthState();
  });

  afterEach(async () => {
    await resetAuthState();
  });

  it('creates the account with a normalized username, email and normalizedEmail', async () => {
    const rawEmail = `  Mixed.Case ${Date.now()}@Example.COM `;
    const expected = rawEmail.toLowerCase().replace(/\s/g, '');

    const result = await createUserAccount(buildUserDetails({ email: rawEmail }));

    const stored = await findUserByUsername(expected);
    expect(stored.id).toBe(result.id);
    expect(stored.get('email')).toBe(expected);
    expect(stored.get('normalizedEmail')).toBe(expected);
  });

  it('returns the new user id together with a session token', async () => {
    const result = await createUserAccount(buildUserDetails());

    expect(typeof result.id).toBe('string');
    expect(typeof result.sessionToken).toBe('string');
    expect(Object.keys(result).sort()).toEqual(['id', 'sessionToken']);
  });

  it('stores the display name on the account', async () => {
    const details = buildUserDetails({ name: 'Ada Lovelace' });

    await createUserAccount(details);

    const stored = await findUserByUsername(details.email);
    expect(stored.get('name')).toBe('Ada Lovelace');
  });

  it('stores the phone number when provided', async () => {
    const details = buildUserDetails({ phone: '+5804141234567' });

    await createUserAccount(details);

    const stored = await findUserByUsername(details.email);
    expect(stored.get('phone')).toBe('+5804141234567');
  });

  it('does not store a phone number when it is absent', async () => {
    const details = buildUserDetails();

    await createUserAccount(details);

    const stored = await findUserByUsername(details.email);
    expect(stored.get('phone')).toBeUndefined();
  });

  it('does not store a phone number when it is an empty string', async () => {
    const details = buildUserDetails({ phone: '' });

    await createUserAccount(details);

    const stored = await findUserByUsername(details.email);
    expect(stored.get('phone')).toBeUndefined();
  });

  it('lets the created user log in with the supplied password', async () => {
    const details = buildUserDetails({ password: 'Another-Passw0rd!' });

    await createUserAccount(details);

    const loggedIn = await Parse.User.logIn(details.email, 'Another-Passw0rd!');
    expect(loggedIn.get('username')).toBe(details.email);
  });

  it('throws USERNAME_TAKEN when an account with the same email already exists', async () => {
    const account = await createPlainUser(uniqueEmail('taken'));

    const error = await captureRejection(
      createUserAccount(buildUserDetails({ email: account.email }))
    );

    expect(error.code).toBe(Parse.Error.USERNAME_TAKEN);
    expect(error.message).toBe('An account with this email already exists.');
  });

  it('detects an existing account regardless of case and whitespace in the email', async () => {
    const account = await createPlainUser(uniqueEmail('taken-case'));
    const disguisedEmail = ` ${account.email.toUpperCase()} `;

    const error = await captureRejection(
      createUserAccount(buildUserDetails({ email: disguisedEmail }))
    );

    expect(error.code).toBe(Parse.Error.USERNAME_TAKEN);
  });

  it('rejects when the email is missing', async () => {
    const details = buildUserDetails();
    delete details.email;

    const error = await captureRejection(createUserAccount(details));

    expect(error.message).toBe('bad or missing username');
  });

  it('rejects when the password is missing', async () => {
    const details = buildUserDetails({ password: undefined });

    const error = await captureRejection(createUserAccount(details));

    expect(error.message).toBe('password is required');
  });

  it('propagates a failure of the follow-up login', async () => {
    const failure = new Error('login unavailable');
    const sdkLogin = spyOn(Parse.User, 'logIn').and.rejectWith(failure);

    const error = await captureRejection(
      createUserAccount(buildUserDetails({ password: PASSWORD }))
    );

    expect(error).toBe(failure);
    expect(sdkLogin).toHaveBeenCalledTimes(1);
  });
});
