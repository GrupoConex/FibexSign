import nodeCrypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import updateExistUserAsAdmin from '../../cloud/parsefunction/UpdateExistUserAsAdmin.js';
import {
  captureConsoleError,
  captureRejection,
  createExtUser,
  createPlainUser,
  createTenant,
  createTenantScope,
  findFirstByUserId,
  pointer,
  purgeAllExtUsers,
  rejectFindFor,
  resolveSaveFor,
  silenceConsole,
  uniqueEmail,
  waitUntil,
} from '../utils/auth-fixtures.js';

const MASTER = { useMasterKey: true };
const MASTER_KEY = process.env.MASTER_KEY;
const originalTimingSafeEqual = nodeCrypto.timingSafeEqual;
const BATCH_SIZE = 100;
const BATCH_WAIT_MS = 12000;
const SETTLE_MS = 100;
const MULTI_BATCH_SPEC_TIMEOUT_MS = 20000;

const createPromotable = async (extras = {}) => {
  const tenant = await createTenant('Legacy Tenant');
  const account = await createPlainUser(uniqueEmail('promotable'));
  const extUser = await createExtUser({
    account,
    role: 'contracts_User',
    tenant,
    extras: { Company: 'Legacy Co', ...extras },
  });
  return { tenant, account, extUser };
};

const findOrganizationOf = extUserId => {
  const query = new Parse.Query('contracts_Organizations');
  query.equalTo('ExtUserId', pointer('contracts_Users', extUserId));
  return query.first(MASTER);
};

const findTeamOf = organizationId => {
  const query = new Parse.Query('contracts_Teams');
  query.equalTo('OrganizationId', pointer('contracts_Organizations', organizationId));
  return query.first(MASTER);
};

const trackBatchSaves = () => {
  const original = Parse.Object.saveAll;
  const tracker = { started: 0, settled: 0 };
  spyOn(Parse.Object, 'saveAll').and.callFake(async (...args) => {
    tracker.started += 1;
    try {
      return await original.apply(Parse.Object, args);
    } finally {
      tracker.settled += 1;
    }
  });
  return tracker;
};

const settle = () => new Promise(resolve => setTimeout(resolve, SETTLE_MS));

const expectedBatches = bystanderCount => Math.floor(bystanderCount / BATCH_SIZE) + 1;

const promote = email => Parse.Cloud.run('updateuserasadmin', { email, masterkey: MASTER_KEY });

const promoteAndSettle = async (email, bystanderCount = 0) => {
  const tracker = trackBatchSaves();
  const result = await promote(email);
  const batches = expectedBatches(bystanderCount);
  const finished = await waitUntil(() => tracker.settled === batches, {
    timeoutMs: BATCH_WAIT_MS,
  });
  await settle();
  expect(finished).toBeTrue();
  expect(tracker.started).toBe(batches);
  return result;
};

const loadRole = async extUserId => {
  const reloaded = await new Parse.Query('contracts_Users').get(extUserId, MASTER);
  return reloaded.get('UserRole');
};

const createBystanders = async count => {
  const bystanders = Array.from({ length: count }, (_, index) => {
    const bystander = new Parse.Object('contracts_Users');
    bystander.set('Email', `bystander-${Date.now()}-${index}@example.com`);
    bystander.set('UserRole', 'contracts_Editor');
    return bystander;
  });
  return Parse.Object.saveAll(bystanders, MASTER);
};

describe('updateuserasadmin cloud function', () => {
  beforeEach(async () => {
    silenceConsole();
    await purgeAllExtUsers();
  });

  afterAll(async () => {
    await purgeAllExtUsers();
  });

  it('rejects with code 404 when the master key is wrong', async () => {
    const error = await captureRejection(
      Parse.Cloud.run('updateuserasadmin', { email: 'a@b.co', masterkey: 'wrong' })
    );

    expect(error.code).toBe(404);
    expect(error.message).toBe('Invalid master key.');
  });

  it('rejects with code 404 when the master key is missing', async () => {
    const error = await captureRejection(Parse.Cloud.run('updateuserasadmin', { email: 'a@b.co' }));

    expect(error.code).toBe(404);
    expect(error.message).toBe('Invalid master key.');
  });

  describe('master key comparison', () => {
    const callWith = masterkey =>
      updateExistUserAsAdmin({ params: { email: 'a@b.co', masterkey } });

    it('compares equal length keys with timingSafeEqual', async () => {
      const comparison = spyOn(nodeCrypto, 'timingSafeEqual').and.callThrough();
      syncBuiltinESMExports();
      let error;
      try {
        error = await captureRejection(callWith('x'.repeat(MASTER_KEY.length)));
      } finally {
        nodeCrypto.timingSafeEqual = originalTimingSafeEqual;
        syncBuiltinESMExports();
      }
      expect(error.message).toBe('Invalid master key.');
      expect(comparison).toHaveBeenCalledTimes(1);
      expect(comparison.calls.mostRecent().args.map(buffer => buffer.length)).toEqual([
        MASTER_KEY.length,
        MASTER_KEY.length,
      ]);
    });

    [
      ['a prefix of the key', () => MASTER_KEY.slice(0, -1)],
      ['the key with extra characters', () => `${MASTER_KEY}x`],
      ['an empty string', () => ''],
      ['a number', () => 12345],
      ['an object', () => ({ toString: () => MASTER_KEY })],
      ['an array holding the key', () => [MASTER_KEY]],
      ['null', () => null],
    ].forEach(([label, build]) => {
      it(`rejects ${label} without comparing buffers of different length`, async () => {
        const error = await captureRejection(callWith(build()));

        expect(error.code).toBe(404);
        expect(error.message).toBe('Invalid master key.');
      });
    });

    it('rejects every key when the server master key is not configured', async () => {
      const configured = process.env.MASTER_KEY;
      delete process.env.MASTER_KEY;
      try {
        const error = await captureRejection(callWith(''));

        expect(error.message).toBe('Invalid master key.');
      } finally {
        process.env.MASTER_KEY = configured;
      }
    });
  });

  it('rejects with DUPLICATE_VALUE when an admin with an organization already exists', async () => {
    const scope = await createTenantScope();
    const account = await createPlainUser();
    await createExtUser({ account, role: 'contracts_Admin', ...scope });
    const { account: candidate, extUser } = await createPromotable();

    const error = await captureRejection(promote(candidate.email));

    expect(error.code).toBe(Parse.Error.DUPLICATE_VALUE);
    expect(error.message).toContain('Admin already exists');
    expect(await loadRole(extUser.id)).toBe('contracts_User');
  });

  it('rejects with OBJECT_NOT_FOUND when no extended user has the given email', async () => {
    const error = await captureRejection(promote(uniqueEmail('unknown')));

    expect(error.code).toBe(Parse.Error.OBJECT_NOT_FOUND);
    expect(error.message).toBe('User not found.');
  });

  it('rejects with OBJECT_NOT_FOUND when the matching extended user is disabled', async () => {
    const { account, extUser } = await createPromotable({ IsDisabled: true });

    const error = await captureRejection(promote(account.email));

    expect(error.code).toBe(Parse.Error.OBJECT_NOT_FOUND);
    expect(error.message).toBe('User not found.');
    expect(await loadRole(extUser.id)).toBe('contracts_User');
  });

  it('rejects and leaves the extended user untouched when it has no tenant', async () => {
    const account = await createPlainUser(uniqueEmail('no-tenant'));
    const extUser = await createExtUser({ account, role: 'contracts_User' });

    const error = await captureRejection(promote(account.email));

    expect(error.code).toBe(400);
    expect(await loadRole(extUser.id)).toBe('contracts_User');
    expect(await findOrganizationOf(extUser.id)).toBeUndefined();
  });

  it('rejects with a domain error and writes nothing when the extended user has no tenant', async () => {
    const account = await createPlainUser(uniqueEmail('no-tenant-message'));
    const extUser = await createExtUser({ account, role: 'contracts_User' });

    const error = await captureRejection(promote(account.email));

    expect(error.code).toBe(400);
    expect(error.message).toBe('User has no tenant.');
    expect(await findOrganizationOf(extUser.id)).toBeUndefined();
  });

  it('rejects with a domain error and writes nothing when the extended user has no linked user', async () => {
    const tenant = await createTenant('Orphan Tenant');
    const email = uniqueEmail('no-user');
    const extUser = new Parse.Object('contracts_Users');
    extUser.set('Email', email);
    extUser.set('UserRole', 'contracts_User');
    extUser.set('TenantId', tenant);
    await extUser.save(null, { useMasterKey: true });

    const error = await captureRejection(promote(email));

    expect(error.code).toBe(400);
    expect(error.message).toBe('User has no linked account.');
    expect(await findOrganizationOf(extUser.id)).toBeUndefined();
    expect(await loadRole(extUser.id)).toBe('contracts_User');
  });

  it('falls back to code 400 and a generic message when the failure has no details', async () => {
    const lookup = rejectFindFor('contracts_Users', {});

    const error = await captureRejection(
      updateExistUserAsAdmin({ params: { email: 'a@b.co', masterkey: MASTER_KEY } })
    );

    expect(error.code).toBe(400);
    expect(error.message).toBe('something went wrong.');
    expect(lookup.hits()).toBe(1);
  });

  it('promotes the user to admin and creates its organization and team', async () => {
    const { tenant, account, extUser } = await createPromotable();

    const result = await promoteAndSettle(account.email);

    const promoted = await findFirstByUserId('contracts_Users', account.id);
    const organization = await findOrganizationOf(extUser.id);
    const team = await findTeamOf(organization.id);
    expect(result).toBe('admin_created');
    expect(promoted.id).toBe(extUser.id);
    expect(promoted.get('UserRole')).toBe('contracts_Admin');
    expect(promoted.get('OrganizationId').id).toBe(organization.id);
    expect(promoted.get('TeamIds').map(entry => entry.id)).toEqual([team.id]);
    expect(organization.get('Name')).toBe('Legacy Co');
    expect(organization.get('IsActive')).toBeTrue();
    expect(organization.get('TenantId').id).toBe(tenant.id);
    expect(organization.get('ExtUserId').id).toBe(extUser.id);
    expect(organization.get('CreatedBy').id).toBe(account.id);
    expect(team.get('Name')).toBe('All Users');
    expect(team.get('OrganizationId').id).toBe(organization.id);
  });

  it('promotes when the only existing admin has no organization yet', async () => {
    const account = await createPlainUser(uniqueEmail('half-admin'));
    const tenant = await createTenant('Half Tenant');
    const extUser = await createExtUser({
      account,
      role: 'contracts_Admin',
      tenant,
      extras: { Company: 'Half Co' },
    });

    const result = await promoteAndSettle(account.email);

    expect(result).toBe('admin_created');
    expect((await findOrganizationOf(extUser.id)).get('Name')).toBe('Half Co');
  });

  it('moves every other extended user into the new organization as a plain user', async () => {
    const { tenant, account, extUser } = await createPromotable();
    const bystanders = await createBystanders(3);

    await promoteAndSettle(account.email, bystanders.length);

    const promotedOrg = await findOrganizationOf(extUser.id);
    for (const bystander of bystanders) {
      const reloaded = await new Parse.Query('contracts_Users').get(bystander.id, MASTER);
      expect(reloaded.get('UserRole')).toBe('contracts_User');
      expect(reloaded.get('OrganizationId').id).toBe(promotedOrg.id);
      expect(reloaded.get('TenantId').id).toBe(tenant.id);
      expect(reloaded.get('CreatedBy').id).toBe(account.id);
      expect(reloaded.get('TeamIds').length).toBe(1);
    }
  });

  it('keeps the promoted admin role after the background reassignment finishes', async () => {
    const { account, extUser } = await createPromotable();
    const bystanders = await createBystanders(2);

    await promoteAndSettle(account.email, bystanders.length);

    expect(await loadRole(extUser.id)).toBe('contracts_Admin');
  });

  it(
    'reassigns extended users across more than one batch',
    async () => {
      const { account } = await createPromotable();
      const bystanders = await createBystanders(BATCH_SIZE + 1);

      await promoteAndSettle(account.email, bystanders.length);

      const reassigned = new Parse.Query('contracts_Users');
      reassigned.equalTo('UserRole', 'contracts_User');
      expect(await reassigned.count(MASTER)).toBe(BATCH_SIZE + 1);
    },
    MULTI_BATCH_SPEC_TIMEOUT_MS
  );

  it('stops after a batch cannot be saved and leaves every other extended user unchanged', async () => {
    const { account } = await createPromotable();
    const bystanders = await createBystanders(2);
    const failure = new Error('batch save failed');
    const errorLog = captureConsoleError();
    const saveAll = spyOn(Parse.Object, 'saveAll').and.rejectWith(failure);

    const result = await promote(account.email);
    await waitUntil(() => saveAll.calls.count() >= 1, { timeoutMs: BATCH_WAIT_MS });
    await settle();

    expect(result).toBe('admin_created');
    expect(saveAll).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledWith('Error while updating user roles:', failure);
    for (const bystander of bystanders) {
      expect(await loadRole(bystander.id)).toBe('contracts_Editor');
    }
  });

  describe('defensive branches (unreachable via public API)', () => {
    it('returns nothing and never reassigns others when the admin save yields no record', async () => {
      const { account } = await createPromotable();
      const [bystander] = await createBystanders(1);
      const tracker = trackBatchSaves();
      resolveSaveFor('contracts_Users', undefined);

      const result = await promote(account.email);
      await settle();

      expect(result).toBeUndefined();
      expect(tracker.started).toBe(0);
      expect(await loadRole(bystander.id)).toBe('contracts_Editor');
    });
  });
});
