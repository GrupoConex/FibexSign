import createUserAccount from '../../cloud/parsefunction/shared/createUserAccount.js';
import {
  PASSWORD,
  buildSignupParams,
  buildUserDetails,
  captureRejection,
  createPlainUser,
  findUserByUsername,
  resetAuthState,
  silenceConsole,
  uniqueEmail,
} from '../utils/auth-fixtures.js';

const createAccount = async details => {
  const { otp } = await buildSignupParams(details);
  return createUserAccount(details, otp);
};
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

    const result = await createAccount(buildUserDetails({ email: rawEmail }));

    const stored = await findUserByUsername(expected);
    expect(stored.id).toBe(result.id);
    expect(stored.get('email')).toBe(expected);
    expect(stored.get('normalizedEmail')).toBe(expected);
  });

  it('marks the account as email verified', async () => {
    const details = buildUserDetails();

    await createAccount(details);

    const stored = await findUserByUsername(details.email);
    expect(stored.get('emailVerified')).toBeTrue();
  });

  it('returns the new user id together with a session token', async () => {
    const result = await createAccount(buildUserDetails());

    expect(typeof result.id).toBe('string');
    expect(typeof result.sessionToken).toBe('string');
    expect(Object.keys(result).sort()).toEqual(['id', 'sessionToken']);
  });

  it('stores the display name on the account', async () => {
    const details = buildUserDetails({ name: 'Ada Lovelace' });

    await createAccount(details);

    const stored = await findUserByUsername(details.email);
    expect(stored.get('name')).toBe('Ada Lovelace');
  });

  it('stores the phone number when provided', async () => {
    const details = buildUserDetails({ phone: '+5804141234567' });

    await createAccount(details);

    const stored = await findUserByUsername(details.email);
    expect(stored.get('phone')).toBe('+5804141234567');
  });

  it('does not store a phone number when it is absent', async () => {
    const details = buildUserDetails();

    await createAccount(details);

    const stored = await findUserByUsername(details.email);
    expect(stored.get('phone')).toBeUndefined();
  });

  it('does not store a phone number when it is an empty string', async () => {
    const details = buildUserDetails({ phone: '' });

    await createAccount(details);

    const stored = await findUserByUsername(details.email);
    expect(stored.get('phone')).toBeUndefined();
  });

  it('lets the created user log in with the supplied password', async () => {
    const details = buildUserDetails({ password: 'Another-Passw0rd!' });

    await createAccount(details);

    const loggedIn = await Parse.User.logIn(details.email, 'Another-Passw0rd!');
    expect(loggedIn.get('username')).toBe(details.email);
  });

  it('throws USERNAME_TAKEN when an account with the same email already exists', async () => {
    const account = await createPlainUser(uniqueEmail('taken'));

    const error = await captureRejection(createAccount(buildUserDetails({ email: account.email })));

    expect(error.code).toBe(Parse.Error.USERNAME_TAKEN);
    expect(error.message).toBe('An account with this email already exists.');
  });

  it('detects an existing account regardless of case and whitespace in the email', async () => {
    const account = await createPlainUser(uniqueEmail('taken-case'));
    const disguisedEmail = ` ${account.email.toUpperCase()} `;

    const error = await captureRejection(
      createAccount(buildUserDetails({ email: disguisedEmail }))
    );

    expect(error.code).toBe(Parse.Error.USERNAME_TAKEN);
  });

  it('rejects when the email is missing, as no otp can match it', async () => {
    const details = buildUserDetails();
    delete details.email;

    const error = await captureRejection(createAccount(details));

    expect(error.code).toBe(Parse.Error.VALIDATION_ERROR);
    expect(error.message).toBe('OTP is invalid.');
  });

  it('rejects when the password is missing', async () => {
    const details = buildUserDetails({ password: undefined });

    const error = await captureRejection(createAccount(details));

    expect(error.message).toBe('password is required');
  });

  it('propagates a failure of the follow-up login', async () => {
    const failure = new Error('login unavailable');
    const sdkLogin = spyOn(Parse.User, 'logIn').and.rejectWith(failure);

    const error = await captureRejection(createAccount(buildUserDetails({ password: PASSWORD })));

    expect(error).toBe(failure);
    expect(sdkLogin).toHaveBeenCalledTimes(1);
  });
});
