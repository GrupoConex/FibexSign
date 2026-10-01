import getUserId from '../../cloud/parsefunction/getUserId.js';
import {
  captureRejection,
  createPlainUser,
  findUserByUsername,
  rejectFirstFor,
  silenceConsole,
  uniqueEmail,
} from '../utils/auth-fixtures.js';

describe('getUserId cloud function', () => {
  beforeEach(() => {
    silenceConsole();
  });

  it('is not registered as a cloud function', async () => {
    const error = await captureRejection(Parse.Cloud.run('getUserId', { email: 'x@y.co' }));

    expect(error.code).toBe(Parse.Error.SCRIPT_FAILED);
  });

  it('returns the user id when searching by username', async () => {
    const account = await createPlainUser(uniqueEmail('byusername'));

    const result = await getUserId({ params: { username: account.email } });

    expect(result).toEqual({ id: account.id });
  });

  it('prefers the username over the email when both are provided', async () => {
    const first = await createPlainUser(uniqueEmail('first'));
    const second = await createPlainUser(uniqueEmail('second'));

    const result = await getUserId({ params: { username: first.email, email: second.email } });

    expect(result).toEqual({ id: first.id });
  });

  it('returns the user id when searching by email', async () => {
    const account = await createPlainUser(uniqueEmail('byemail'));
    const stored = await findUserByUsername(account.email);

    const result = await getUserId({ params: { email: stored.get('email') } });

    expect(result).toEqual({ id: account.id });
  });

  it('rejects with OBJECT_NOT_FOUND when no user matches', async () => {
    const outcome = await captureRejection(
      getUserId({ params: { username: uniqueEmail('missing') } })
    );

    expect(outcome).not.toBeNull();
    expect(outcome.code).toBe(Parse.Error.OBJECT_NOT_FOUND);
    expect(outcome.message).toBe('User not found.');
  });

  it('rejects with the failure when the query fails', async () => {
    const failure = new Error('db down');
    const lookup = rejectFirstFor('_User', failure);

    const outcome = await captureRejection(getUserId({ params: { username: 'anyone' } }));

    expect(lookup.hits()).toBe(1);
    expect(outcome).toBe(failure);
  });
});
