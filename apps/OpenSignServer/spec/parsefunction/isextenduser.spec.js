import isextenduser from '../../cloud/parsefunction/isextenduser.js';
import {
  captureRejection,
  createExtUser,
  createPlainUser,
  rejectFirstFor,
  silenceConsole,
  uniqueEmail,
} from '../utils/auth-fixtures.js';

describe('isextenduser cloud function', () => {
  beforeEach(() => {
    silenceConsole();
  });

  it('returns isUserExist true when an ext user has the given email', async () => {
    const account = await createPlainUser(uniqueEmail('ext-exists'));
    await createExtUser({ account, role: 'contracts_User' });

    const result = await Parse.Cloud.run('isextenduser', { email: account.email });

    expect(result).toEqual({ isUserExist: true });
  });

  it('returns isUserExist false when no ext user has the given email', async () => {
    const result = await Parse.Cloud.run('isextenduser', { email: uniqueEmail('ext-missing') });

    expect(result).toEqual({ isUserExist: false });
  });

  it('characterization: email matching is case sensitive', async () => {
    const account = await createPlainUser(uniqueEmail('ext-case'));
    await createExtUser({ account, role: 'contracts_User' });

    const result = await Parse.Cloud.run('isextenduser', { email: account.email.toUpperCase() });

    expect(result).toEqual({ isUserExist: false });
  });

  it('rethrows a parse error with the original code and message when the query fails', async () => {
    const lookup = rejectFirstFor('contracts_Users', { code: 141, message: 'db exploded' });

    const error = await captureRejection(isextenduser({ params: { email: 'a@b.co' } }));

    expect(error.code).toBe(141);
    expect(error.message).toBe('db exploded');
    expect(lookup.hits()).toBe(1);
  });

  it('falls back to code 400 and a generic message when the failure has no details', async () => {
    const lookup = rejectFirstFor('contracts_Users', {});

    const error = await captureRejection(isextenduser({ params: { email: 'a@b.co' } }));

    expect(error.code).toBe(400);
    expect(error.message).toBe('Something went wrong.');
    expect(lookup.hits()).toBe(1);
  });

  it('falls back to code 400 when the failure is nullish', async () => {
    const lookup = rejectFirstFor('contracts_Users', undefined);

    const error = await captureRejection(isextenduser({ params: { email: 'a@b.co' } }));

    expect(error.code).toBe(400);
    expect(error.message).toBe('Something went wrong.');
    expect(lookup.hits()).toBe(1);
  });
});
