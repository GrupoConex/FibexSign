import { createRequire } from 'node:module';
import axios from 'axios';
import {
  createPlainUser,
  pointer,
  purgeCreatedAccounts,
  resetAuthState,
  silenceConsole,
  uniqueEmail,
} from '../utils/auth-fixtures.js';

const require = createRequire(import.meta.url);
const migration = require('../../databases/migrations/20261009130000-lock_contracts_signature_clp.cjs');

const MASTER = { useMasterKey: true };
const CLASS_NAME = 'contracts_Signature';
const OPERATIONS = ['get', 'find', 'count', 'create', 'update', 'delete', 'addField'];
const PUBLIC_CLP = {
  get: { '*': true },
  find: { '*': true },
  count: { '*': true },
  create: { '*': true },
  update: { '*': true },
  delete: {},
  addField: {},
};
const OPERATION_FORBIDDEN = 119;
const PAGE_OVERFLOW_ROWS = 520;
const ROLLBACK_NOTICE =
  'lock_contracts_signature_clp is a security fix and is not reverted on rollback';

const rest = (method, path, { data, sessionToken } = {}) =>
  axios({
    method,
    url: `${process.env.SERVER_URL}${path}`,
    data,
    headers: {
      'X-Parse-Application-Id': process.env.APP_ID,
      'X-Parse-Javascript-Key': 'test',
      ...(sessionToken ? { 'X-Parse-Session-Token': sessionToken } : {}),
    },
    validateStatus: () => true,
  });

const classExists = async () => {
  try {
    await new Parse.Schema(CLASS_NAME).get();
    return true;
  } catch {
    return false;
  }
};

const readClp = async () => (await new Parse.Schema(CLASS_NAME).get()).classLevelPermissions;

const writeClp = async classLevelPermissions => {
  const schema = new Parse.Schema(CLASS_NAME);
  schema.setCLP(classLevelPermissions);
  if (await classExists()) {
    await schema.update();
  } else {
    await schema.save();
  }
};

const dropClass = async () => {
  const schema = new Parse.Schema(CLASS_NAME);
  await schema.purge();
  await schema.delete();
};

const seedRow = async (ownerId, acl) => {
  const row = new Parse.Object(CLASS_NAME);
  row.set('ImageURL', 'https://cdn.firma.example/victim_sign.png');
  row.set('SignatureName', 'victim');
  if (ownerId) row.set('UserId', pointer('_User', ownerId));
  if (acl) row.setACL(acl);
  return row.save(null, MASTER);
};

const readAcl = async id => {
  const row = await new Parse.Query(CLASS_NAME).select('ACL', 'UserId').get(id, MASTER);
  return row.getACL()?.toJSON();
};

const ownerAcl = ownerId => ({ [ownerId]: { read: true, write: true } });

const privateAcl = ownerId => {
  const acl = new Parse.ACL();
  acl.setReadAccess(ownerId, true);
  acl.setWriteAccess(ownerId, true);
  return acl;
};

const publicAcl = () => {
  const acl = new Parse.ACL();
  acl.setPublicReadAccess(true);
  acl.setPublicWriteAccess(true);
  return acl;
};

const buildAttempts = (rowId, sessionToken) => ({
  find: () => rest('GET', `/classes/${CLASS_NAME}`, { sessionToken }),
  get: () => rest('GET', `/classes/${CLASS_NAME}/${rowId}`, { sessionToken }),
  count: () => rest('GET', `/classes/${CLASS_NAME}?count=1&limit=0`, { sessionToken }),
  create: () =>
    rest('POST', `/classes/${CLASS_NAME}`, { data: { SignatureName: 'x' }, sessionToken }),
  update: () =>
    rest('PUT', `/classes/${CLASS_NAME}/${rowId}`, { data: { SignatureName: 'x' }, sessionToken }),
  delete: () => rest('DELETE', `/classes/${CLASS_NAME}/${rowId}`, { sessionToken }),
  addField: () =>
    rest('PUT', `/classes/${CLASS_NAME}/${rowId}`, { data: { NewField: 'x' }, sessionToken }),
});

describe('contracts_Signature CLP migration', () => {
  let originalClp;
  let classExisted;

  beforeAll(async () => {
    classExisted = await classExists();
    if (!classExisted) await writeClp(PUBLIC_CLP);
    originalClp = await readClp();
  });

  beforeEach(async () => {
    silenceConsole();
    await resetAuthState();
    await writeClp(PUBLIC_CLP);
  });

  afterAll(async () => {
    await purgeCreatedAccounts();
    if (classExisted) await writeClp(originalClp);
    else await dropClass();
  });

  describe('attack on the open schema', () => {
    it('lets an anonymous client list every stored signature', async () => {
      const victim = await createPlainUser(uniqueEmail('victim'));
      await seedRow(victim.id);

      const response = await rest('GET', `/classes/${CLASS_NAME}`);

      expect(JSON.stringify(response.data)).toContain('victim');
    });

    it('lets an anonymous client replace the signature of someone else', async () => {
      const victim = await createPlainUser(uniqueEmail('victim'));
      const row = await seedRow(victim.id);

      const response = await rest('PUT', `/classes/${CLASS_NAME}/${row.id}`, {
        data: { ImageURL: 'https://attacker.example/forged.png' },
      });

      expect(response.status).toBe(200);
    });
  });

  describe('after the migration', () => {
    const identities = {
      'an anonymous client': async () => undefined,
      'a signed in user': async () => (await createPlainUser(uniqueEmail('member'))).sessionToken,
    };

    Object.entries(identities).forEach(([identity, resolveSession]) => {
      OPERATIONS.forEach(operation => {
        it(`denies ${operation} to ${identity}`, async () => {
          const victim = await createPlainUser(uniqueEmail('victim'));
          const row = await seedRow(victim.id);
          const sessionToken = await resolveSession();
          await migration.up(Parse);

          const response = await buildAttempts(row.id, sessionToken)[operation]();

          expect(response.status).toBeGreaterThanOrEqual(400);
          expect(response.data.code).toBe(OPERATION_FORBIDDEN);
        });
      });
    });

    it('does not expose the stored signature to the owner through the rest api', async () => {
      const victim = await createPlainUser(uniqueEmail('victim'));
      const row = await seedRow(victim.id);
      await migration.up(Parse);

      const response = await buildAttempts(row.id, victim.sessionToken).get();

      expect(response.data.code).toBe(OPERATION_FORBIDDEN);
    });

    it('keeps the row reachable with the master key', async () => {
      const row = await seedRow();
      await migration.up(Parse);

      const found = await new Parse.Query(CLASS_NAME).equalTo('objectId', row.id).first(MASTER);

      expect(found.id).toBe(row.id);
    });

    it('leaves every operation master only', async () => {
      await migration.up(Parse);

      const clp = await readClp();

      OPERATIONS.forEach(operation => expect(clp[operation]).toEqual({}));
    });
  });

  describe('legitimate flows with the class closed', () => {
    beforeEach(async () => {
      await migration.up(Parse);
    });

    it('lets the signature cloud functions create and read the own row', async () => {
      const account = await createPlainUser(uniqueEmail('signer'));
      const options = { sessionToken: account.sessionToken };
      const url = `${process.env.SERVER_URL}/files/test/own.png`;

      const saved = await Parse.Cloud.run('managesign', { signature: url }, options);
      const found = await Parse.Cloud.run('getdefaultsignature', { userId: account.id }, options);

      expect(found.id).toBe(saved.id);
    });
  });

  describe('backfill of existing rows', () => {
    it('gives a row without ACL a private ACL for its owner', async () => {
      const owner = await createPlainUser(uniqueEmail('owner'));
      const row = await seedRow(owner.id);

      await migration.up(Parse);

      expect(await readAcl(row.id)).toEqual(ownerAcl(owner.id));
    });

    it('replaces a public ACL with a private one for the owner', async () => {
      const owner = await createPlainUser(uniqueEmail('owner'));
      const row = await seedRow(owner.id, publicAcl());

      await migration.up(Parse);

      expect(await readAcl(row.id)).toEqual(ownerAcl(owner.id));
    });

    it('locks a row without owner to the master key', async () => {
      const row = await seedRow();

      await migration.up(Parse);

      expect(await readAcl(row.id)).toEqual({});
    });

    it('leaves an already private row untouched', async () => {
      const owner = await createPlainUser(uniqueEmail('owner'));
      const row = await seedRow(owner.id, privateAcl(owner.id));
      const before = (await new Parse.Query(CLASS_NAME).get(row.id, MASTER)).updatedAt;

      await migration.up(Parse);

      const after = (await new Parse.Query(CLASS_NAME).get(row.id, MASTER)).updatedAt;
      expect(after.getTime()).toBe(before.getTime());
    });

    it('is idempotent', async () => {
      const owner = await createPlainUser(uniqueEmail('owner'));
      const row = await seedRow(owner.id);

      await migration.up(Parse);
      await migration.up(Parse);

      expect(await readAcl(row.id)).toEqual(ownerAcl(owner.id));
    });

    it('processes more rows than a single page', async () => {
      const owner = await createPlainUser(uniqueEmail('owner'));
      const rows = Array.from({ length: PAGE_OVERFLOW_ROWS }, () => {
        const row = new Parse.Object(CLASS_NAME);
        row.set('UserId', pointer('_User', owner.id));
        return row;
      });
      await Parse.Object.saveAll(rows, { ...MASTER, batchSize: 100 });

      await migration.up(Parse);

      const unprotectedIds = [];
      await new Parse.Query(CLASS_NAME)
        .equalTo('UserId', pointer('_User', owner.id))
        .select('ACL')
        .each(row => {
          const acl = row.getACL()?.toJSON();
          if (JSON.stringify(Object.keys(acl ?? {})) !== JSON.stringify([owner.id])) {
            unprotectedIds.push(row.id);
          }
        }, MASTER);
      expect(unprotectedIds).toEqual([]);
    }, 120000);
  });

  describe('up and down', () => {
    it('keeps the other schema settings', async () => {
      await seedRow();
      const schema = new Parse.Schema(CLASS_NAME);
      schema.setCLP({ ...PUBLIC_CLP, protectedFields: { '*': ['SignatureName'] } });
      await schema.update();

      await migration.up(Parse);

      expect((await readClp()).protectedFields).toEqual({ '*': ['SignatureName'] });
    });

    it('creates a missing class already closed', async () => {
      await dropClass();

      await migration.up(Parse);

      expect(await classExists()).toBeTrue();
      const clp = await readClp();
      OPERATIONS.forEach(operation => expect(clp[operation]).toEqual({}));
    });

    it('does not hide unexpected schema errors', async () => {
      spyOn(Parse.Schema.prototype, 'get').and.rejectWith(new Error('database offline'));

      await expectAsync(migration.up(Parse)).toBeRejectedWithError('database offline');
    });

    it('reports that the security fix is not reverted on rollback', async () => {
      const warn = spyOn(console, 'warn');
      await migration.up(Parse);

      await migration.down(Parse);

      expect(warn).toHaveBeenCalledOnceWith(ROLLBACK_NOTICE);
    });

    it('keeps the class closed to the public when rolled back', async () => {
      spyOn(console, 'warn');
      await migration.up(Parse);

      await migration.down(Parse);

      const clp = await readClp();
      OPERATIONS.forEach(operation => expect(clp[operation]).toEqual({}));
    });

    it('keeps the owner acl when rolled back', async () => {
      spyOn(console, 'warn');
      const owner = await createPlainUser(uniqueEmail('owner'));
      const row = await seedRow(owner.id);
      await migration.up(Parse);

      await migration.down(Parse);

      expect(await readAcl(row.id)).toEqual(ownerAcl(owner.id));
    });

    it('rolls back without failing when the class is missing', async () => {
      spyOn(console, 'warn');
      await dropClass();

      await expectAsync(migration.down(Parse)).toBeResolved();
    });
  });
});
