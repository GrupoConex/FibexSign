import checkAdminExist from '../../cloud/parsefunction/CheckAdminExist.js';
import {
  captureRejection,
  createExtUser,
  createPlainUser,
  createTenantScope,
  purgeAllExtUsers,
  rejectFindFor,
  silenceConsole,
} from '../utils/auth-fixtures.js';

const createAdmin = async (scope, extras = {}) => {
  const account = await createPlainUser();
  return createExtUser({ account, role: 'contracts_Admin', ...scope, extras });
};

describe('checkadminexist cloud function', () => {
  beforeEach(async () => {
    silenceConsole();
    await purgeAllExtUsers();
  });

  afterAll(async () => {
    await purgeAllExtUsers();
  });

  it('returns not_exist when there are no admins', async () => {
    const result = await Parse.Cloud.run('checkadminexist');

    expect(result).toBe('not_exist');
  });

  it('returns exist when exactly one admin with an organization exists', async () => {
    await createAdmin(await createTenantScope());

    const result = await Parse.Cloud.run('checkadminexist');

    expect(result).toBe('exist');
  });

  it('returns not_exist when the single admin has no organization', async () => {
    const { tenant } = await createTenantScope();
    await createAdmin({ tenant });

    const result = await Parse.Cloud.run('checkadminexist');

    expect(result).toBe('not_exist');
  });

  it('returns not_exist when more than one admin exists', async () => {
    await createAdmin(await createTenantScope());
    await createAdmin(await createTenantScope());

    const result = await Parse.Cloud.run('checkadminexist');

    expect(result).toBe('not_exist');
  });

  it('ignores disabled admins', async () => {
    await createAdmin(await createTenantScope(), { IsDisabled: true });

    const result = await Parse.Cloud.run('checkadminexist');

    expect(result).toBe('not_exist');
  });

  it('ignores non admin roles', async () => {
    const scope = await createTenantScope();
    const account = await createPlainUser();
    await createExtUser({ account, role: 'contracts_User', ...scope });

    const result = await Parse.Cloud.run('checkadminexist');

    expect(result).toBe('not_exist');
  });

  it('rethrows a parse error carrying the original code and message when the query fails', async () => {
    const lookup = rejectFindFor('contracts_Users', { code: 141, message: 'db exploded' });

    const error = await captureRejection(checkAdminExist());

    expect(error.code).toBe(141);
    expect(error.message).toBe('db exploded');
    expect(lookup.hits()).toBe(1);
  });

  it('falls back to code 400 and a generic message when the failure has no details', async () => {
    const lookup = rejectFindFor('contracts_Users', {});

    const error = await captureRejection(checkAdminExist());

    expect(error.code).toBe(400);
    expect(error.message).toBe('something went wrong.');
    expect(lookup.hits()).toBe(1);
  });

  it('falls back to code 400 when the failure is nullish', async () => {
    const lookup = rejectFindFor('contracts_Users', undefined);

    const error = await captureRejection(checkAdminExist());

    expect(error.code).toBe(400);
    expect(error.message).toBe('something went wrong.');
    expect(lookup.hits()).toBe(1);
  });
});
