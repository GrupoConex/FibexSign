import loginUser from '../../cloud/parsefunction/loginUser.js';
import {
  PASSWORD,
  captureRejection,
  createPlainUser,
  markEmailVerified,
  resetAuthState,
  silenceConsole,
  uniqueEmail,
} from '../utils/auth-fixtures.js';

describe('loginuser cloud function', () => {
  beforeEach(async () => {
    silenceConsole();
    await resetAuthState();
  });

  afterEach(async () => {
    await resetAuthState();
  });

  it('returns the user json with a session token when credentials are valid', async () => {
    const account = await createPlainUser();
    await markEmailVerified(account.id);

    const result = await Parse.Cloud.run('loginuser', {
      email: account.email,
      password: PASSWORD,
    });

    expect(result.objectId).toBe(account.id);
    expect(result.username).toBe(account.email);
    expect(typeof result.sessionToken).toBe('string');
  });

  it('rejects with PASSWORD_MISSING when the password is not provided', async () => {
    const error = await captureRejection(
      Parse.Cloud.run('loginuser', { email: uniqueEmail('nopass') })
    );

    expect(error.code).toBe(Parse.Error.PASSWORD_MISSING);
    expect(error.message).toBe('username/password is missing.');
  });

  it('rejects with PASSWORD_MISSING when the email is not provided', async () => {
    const error = await captureRejection(Parse.Cloud.run('loginuser', { password: PASSWORD }));

    expect(error.code).toBe(Parse.Error.PASSWORD_MISSING);
  });

  it('rejects with PASSWORD_MISSING when both credentials are empty strings', async () => {
    const error = await captureRejection(Parse.Cloud.run('loginuser', { email: '', password: '' }));

    expect(error.code).toBe(Parse.Error.PASSWORD_MISSING);
  });

  it('rethrows the parse error when the password is wrong', async () => {
    const account = await createPlainUser();

    const error = await captureRejection(
      Parse.Cloud.run('loginuser', { email: account.email, password: 'wrong-password-value' })
    );

    expect(error.code).toBe(Parse.Error.OBJECT_NOT_FOUND);
    expect(error.message).toBe('Invalid username/password.');
  });

  it('rethrows the parse error when the account does not exist', async () => {
    const error = await captureRejection(
      Parse.Cloud.run('loginuser', { email: uniqueEmail('ghost'), password: PASSWORD })
    );

    expect(error.code).toBe(Parse.Error.OBJECT_NOT_FOUND);
  });

  it('throws OBJECT_NOT_FOUND when the sdk login resolves without a user', async () => {
    const sdkLogin = spyOn(Parse.User, 'logIn').and.resolveTo(undefined);

    const error = await captureRejection(
      loginUser({ params: { email: uniqueEmail('empty'), password: PASSWORD } })
    );

    expect(error.code).toBe(Parse.Error.OBJECT_NOT_FOUND);
    expect(error.message).toBe('user not found.');
    expect(sdkLogin).toHaveBeenCalledTimes(1);
  });

  it('propagates unexpected sdk failures unchanged', async () => {
    const failure = new Error('network down');
    const sdkLogin = spyOn(Parse.User, 'logIn').and.rejectWith(failure);

    const error = await captureRejection(
      loginUser({ params: { email: uniqueEmail('boom'), password: PASSWORD } })
    );

    expect(error).toBe(failure);
    expect(sdkLogin).toHaveBeenCalledTimes(1);
  });
});
