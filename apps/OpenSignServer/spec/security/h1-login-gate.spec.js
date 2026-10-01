import axios from 'axios';
import {
  PASSWORD,
  captureRejection,
  createAuthDataAccount,
  createMasterKeySession,
  createPlainUser,
  createTenantOwner,
  isSessionValid,
  markEmailVerified,
  openPasswordSession,
  resetAuthState,
  silenceConsole,
} from '../utils/auth-fixtures.js';

const EMAIL_NOT_VERIFIED_MESSAGE = 'Email not verified.';

const loginOverRest = (email, password = PASSWORD) =>
  captureRejection(openPasswordSession(email, password));

const publicHeaders = () => ({
  'X-Parse-Application-Id': process.env.APP_ID,
  'X-Parse-Javascript-Key': 'test',
});

const loginWithAuthData = authId =>
  axios.post(
    `${process.env.SERVER_URL}/users`,
    { authData: { anonymous: { id: authId } } },
    { headers: publicHeaders(), validateStatus: () => true }
  );

describe('beforeLogin email verification gate', () => {
  beforeEach(async () => {
    silenceConsole();
    await resetAuthState();
  });

  afterEach(async () => {
    await resetAuthState();
  });

  it('blocks REST /login for an unverified account that owns no tenant', async () => {
    const account = await createPlainUser();

    const error = await loginOverRest(account.email);

    expect(error.response.data.code).toBe(Parse.Error.EMAIL_NOT_FOUND);
    expect(error.response.data.error).toBe(EMAIL_NOT_VERIFIED_MESSAGE);
  });

  it('blocks Parse.User.logIn for an unverified account that owns no tenant', async () => {
    const account = await createPlainUser();

    const error = await captureRejection(Parse.User.logIn(account.email, PASSWORD));

    expect(error.code).toBe(Parse.Error.EMAIL_NOT_FOUND);
    expect(error.message).toBe(EMAIL_NOT_VERIFIED_MESSAGE);
  });

  it('blocks the loginuser cloud function for an unverified non-owner', async () => {
    const account = await createPlainUser();

    const error = await captureRejection(
      Parse.Cloud.run('loginuser', { email: account.email, password: PASSWORD })
    );

    expect(error.code).toBe(Parse.Error.EMAIL_NOT_FOUND);
    expect(error.message).toBe(EMAIL_NOT_VERIFIED_MESSAGE);
  });

  it('still reports invalid credentials for a wrong password on an unverified account', async () => {
    const account = await createPlainUser();

    const error = await loginOverRest(account.email, 'wrong-password-value');

    expect(error.response.data.code).toBe(Parse.Error.OBJECT_NOT_FOUND);
  });

  it('lets a verified account log in over REST', async () => {
    const account = await createPlainUser();
    await markEmailVerified(account.id);

    const sessionToken = await openPasswordSession(account.email);

    expect(await isSessionValid(sessionToken)).toBeTrue();
  });

  it('lets an unverified tenant owner log in', async () => {
    const { account } = await createTenantOwner();

    const sessionToken = await openPasswordSession(account.email);

    expect(await isSessionValid(sessionToken)).toBeTrue();
  });

  it('does not gate the master key loginAs used after an OTP', async () => {
    const account = await createPlainUser();

    const sessionToken = await createMasterKeySession(account.id);

    expect(await isSessionValid(sessionToken)).toBeTrue();
  });

  it('blocks an authData login of an unverified non-owner', async () => {
    const authId = `gate-${Date.now()}`;
    await createAuthDataAccount(authId);

    const response = await loginWithAuthData(authId);

    expect(response.status).toBe(400);
    expect(response.data.code).toBe(Parse.Error.EMAIL_NOT_FOUND);
    expect(response.data.error).toBe(EMAIL_NOT_VERIFIED_MESSAGE);
  });

  it('lets a verified account log in through authData', async () => {
    const authId = `gate-ok-${Date.now()}`;
    const account = await createAuthDataAccount(authId);
    await markEmailVerified(account.id);

    const response = await loginWithAuthData(authId);

    expect(response.status).toBe(200);
    expect(await isSessionValid(response.data.sessionToken)).toBeTrue();
  });
});
