import {
  createExtUser,
  createPlainUser,
  createTenantScope,
  purgeCreatedAccounts,
  uniqueEmail,
} from '../../../spec/utils/auth-fixtures.js';
import { buildActiveProfileQuery } from './activeProfileQuery.js';

const MASTER = { useMasterKey: true };

const createProfile = async (account, extras = {}) =>
  createExtUser({ account, role: 'contracts_User', ...(await createTenantScope()), extras });

describe('buildActiveProfileQuery', () => {
  afterEach(async () => {
    await purgeCreatedAccounts();
  });

  it('matches the enabled profiles of the user, own and linked alike', async () => {
    const account = await createPlainUser(uniqueEmail('active-profile'));
    const own = await createProfile(account);
    const linked = await createProfile(account, { IsLinkedAccount: true });

    const ids = (await buildActiveProfileQuery(account.id).findAll(MASTER)).map(row => row.id);

    expect(ids.sort()).toEqual([own.id, linked.id].sort());
  });

  it('skips disabled and removed profiles and profiles of other users', async () => {
    const account = await createPlainUser(uniqueEmail('inactive-profile'));
    const other = await createPlainUser(uniqueEmail('other-profile'));
    await createProfile(account, { IsDisabled: true });
    await createProfile(account, { IsLinkedAccount: true, RemovedFromOrgAt: new Date() });
    await createProfile(other);

    expect(await buildActiveProfileQuery(account.id).first(MASTER)).toBeUndefined();
  });
});
