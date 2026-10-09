import { createRequire } from 'node:module';
import axios from 'axios';
import { MongoClient } from 'mongodb';
import { OTP_COLLECTION, migrateOtpTable } from '../../scripts/migrate-otp-table.js';
import {
  OtpStatus,
  hashOtp,
  issueOtp,
  verifyAndConsumeOtp,
} from '../../cloud/parsefunction/shared/otpPolicy.js';
import {
  buildUserDetails,
  captureRejection,
  createPlainUser,
  findUserByUsername,
  resetAuthState,
  runSignup,
  silenceConsole,
  uniqueEmail,
} from '../utils/auth-fixtures.js';

const require = createRequire(import.meta.url);
const migration = require('../../databases/migrations/20261009120000-lock_internal_classes_clp.cjs');

const MASTER = { useMasterKey: true };
const OPERATIONS = ['get', 'find', 'count', 'create', 'update', 'delete', 'addField'];
const PUBLIC_CLP = Object.fromEntries(OPERATIONS.map(operation => [operation, { '*': true }]));
const MASTER_ONLY_CLP = Object.fromEntries(OPERATIONS.map(operation => [operation, {}]));
const LOCKED_CLASSES = ['defaultdata_Otp', 'Migration', '_Role'];
const OPERATION_FORBIDDEN = 119;
const MAX_FAILED_ATTEMPTS = 5;
const WRONG_CODE = '000001';
const REOPEN_WARNING =
  'Rolling back lock_internal_classes_clp re-opens public access to internal classes';

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

const classExists = async className => {
  try {
    await new Parse.Schema(className).get();
    return true;
  } catch {
    return false;
  }
};

const readClp = async className => (await new Parse.Schema(className).get()).classLevelPermissions;

const writeClp = async (className, classLevelPermissions) => {
  const schema = new Parse.Schema(className);
  schema.setCLP(classLevelPermissions);
  if (await classExists(className)) {
    await schema.update();
  } else {
    await schema.save();
  }
};

const restoreOtpUniqueIndex = async () => {
  const client = new MongoClient('mongodb://localhost:27017/parse-test');
  await client.connect();
  try {
    await migrateOtpTable({ collection: client.db().collection(OTP_COLLECTION), apply: true });
  } finally {
    await client.close();
  }
};

const dropClass = async className => {
  const schema = new Parse.Schema(className);
  await schema.purge();
  await schema.delete();
};

let roleSequence = 0;

const seedRow = async className => {
  if (className === '_Role') {
    return new Parse.Role(`role_${Date.now()}_${roleSequence++}`, new Parse.ACL()).save(
      null,
      MASTER
    );
  }
  const row = new Parse.Object(className);
  row.set(className === 'Migration' ? 'name' : 'Email', uniqueEmail('seed'));
  return row.save(null, MASTER);
};

const buildAttempts = (className, rowId, sessionToken) => ({
  find: () => rest('GET', `/classes/${className}`, { sessionToken }),
  get: () => rest('GET', `/classes/${className}/${rowId}`, { sessionToken }),
  count: () => rest('GET', `/classes/${className}?count=1&limit=0`, { sessionToken }),
  create: () => rest('POST', `/classes/${className}`, { data: { Probe: 1 }, sessionToken }),
  update: () => rest('PUT', `/classes/${className}/${rowId}`, { data: { Probe: 1 }, sessionToken }),
  delete: () => rest('DELETE', `/classes/${className}/${rowId}`, { sessionToken }),
  addField: () =>
    rest('PUT', `/classes/${className}/${rowId}`, { data: { NewField: 'x' }, sessionToken }),
});

const lockOtpRow = async email => {
  const { otp } = await issueOtp({ email });
  for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS; attempt += 1) {
    await verifyAndConsumeOtp({ email, otp: WRONG_CODE });
  }
  const row = await new Parse.Query('defaultdata_Otp').equalTo('Email', email).first(MASTER);
  return { otp, row };
};

describe('internal classes CLP migration', () => {
  let originalClps;
  let migrationClassExisted;

  beforeAll(async () => {
    migrationClassExisted = await classExists('Migration');
    for (const className of LOCKED_CLASSES) {
      if (!(await classExists(className))) {
        await writeClp(className, PUBLIC_CLP);
      }
    }
    originalClps = Object.fromEntries(
      await Promise.all(LOCKED_CLASSES.map(async name => [name, await readClp(name)]))
    );
  });

  beforeEach(async () => {
    silenceConsole();
    await resetAuthState();
    for (const className of LOCKED_CLASSES) {
      await writeClp(className, PUBLIC_CLP);
    }
  });

  afterAll(async () => {
    for (const className of LOCKED_CLASSES) {
      await writeClp(className, originalClps[className]);
    }
    if (!migrationClassExisted) {
      await dropClass('Migration');
    }
  });

  describe('attack on the open schema', () => {
    it('lets an anonymous client reset the OTP lockout and keep guessing', async () => {
      const email = uniqueEmail('victim');
      const { otp, row } = await lockOtpRow(email);

      const reset = await rest('PUT', `/classes/defaultdata_Otp/${row.id}`, {
        data: { FailedAttempts: 0 },
      });

      expect(reset.status).toBe(200);
      expect(await verifyAndConsumeOtp({ email, otp })).toBe(OtpStatus.VALID);
    });

    it('lets an anonymous client read the stored OTP hash', async () => {
      const email = uniqueEmail('reader');
      const { otp } = await issueOtp({ email });

      const response = await rest(
        'GET',
        `/classes/defaultdata_Otp?where=${JSON.stringify({ Email: email })}`
      );

      expect(JSON.stringify(response.data)).toContain(hashOtp(otp));
    });

    it('lets an anonymous client create roles', async () => {
      const response = await rest('POST', '/classes/_Role', {
        data: { name: `anon-${Date.now()}`, ACL: { '*': { read: true } } },
      });

      expect(response.status).toBe(201);
    });
  });

  describe('lockout bypass after the migration', () => {
    it('keeps a locked OTP locked when an anonymous client tries to reset it', async () => {
      const email = uniqueEmail('protected');
      const { otp, row } = await lockOtpRow(email);
      await migration.up(Parse);

      const reset = await rest('PUT', `/classes/defaultdata_Otp/${row.id}`, {
        data: { FailedAttempts: 0 },
      });

      expect(reset.status).toBeGreaterThanOrEqual(400);
      expect(reset.data.code).toBe(OPERATION_FORBIDDEN);
      expect(await verifyAndConsumeOtp({ email, otp })).toBe(OtpStatus.LOCKED);
    });

    it('no longer exposes the stored OTP hash', async () => {
      const email = uniqueEmail('hidden');
      const { otp } = await issueOtp({ email });
      await migration.up(Parse);

      const response = await rest(
        'GET',
        `/classes/defaultdata_Otp?where=${JSON.stringify({ Email: email })}`
      );

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(response.data)).not.toContain(hashOtp(otp));
    });
  });

  LOCKED_CLASSES.forEach(className => {
    describe(`${className} after the migration`, () => {
      const identities = {
        'an anonymous client': async () => undefined,
        'a signed in user': async () => (await createPlainUser(uniqueEmail('member'))).sessionToken,
      };

      Object.entries(identities).forEach(([identity, resolveSession]) => {
        OPERATIONS.forEach(operation => {
          it(`denies ${operation} to ${identity}`, async () => {
            const row = await seedRow(className);
            const sessionToken = await resolveSession();
            await migration.up(Parse);

            const response = await buildAttempts(className, row.id, sessionToken)[operation]();

            expect(response.status).toBeGreaterThanOrEqual(400);
            expect(response.data.code).toBe(OPERATION_FORBIDDEN);
          });
        });
      });

      it('keeps the row reachable with the master key', async () => {
        const row = await seedRow(className);
        await migration.up(Parse);

        const found = await new Parse.Query(className).equalTo('objectId', row.id).first(MASTER);

        expect(found.id).toBe(row.id);
      });

      it('leaves the schema permissions master only', async () => {
        await migration.up(Parse);

        const clp = await readClp(className);

        OPERATIONS.forEach(operation => expect(clp[operation]).toEqual({}));
      });
    });
  });

  describe('legitimate flows with the classes closed', () => {
    beforeEach(async () => {
      await migration.up(Parse);
    });

    it('issues and verifies an OTP through server code', async () => {
      const email = uniqueEmail('flow');

      const { otp } = await issueOtp({ email });

      expect(await verifyAndConsumeOtp({ email, otp })).toBe(OtpStatus.VALID);
    });

    it('completes a signup that consumes an OTP row', async () => {
      const details = buildUserDetails({ role: 'contracts_User' });

      await runSignup('usersignup', details);

      expect(await findUserByUsername(details.email.toLowerCase())).toBeDefined();
    });

    it('lets the migration tool write its bookkeeping rows', async () => {
      const row = new Parse.Object('Migration');
      row.set('name', '20260101000000-example');

      const saved = await row.save(null, MASTER);

      expect(saved.id).toBeDefined();
      await saved.destroy(MASTER);
    });

    it('lets server code create and resolve roles', async () => {
      const role = await new Parse.Role(
        `ops_${Date.now()}_${roleSequence++}`,
        new Parse.ACL()
      ).save(null, MASTER);

      const found = await new Parse.Query(Parse.Role).get(role.id, MASTER);

      expect(found.id).toBe(role.id);
    });
  });

  describe('up and down', () => {
    it('keeps the other schema settings of each class', async () => {
      const schema = new Parse.Schema('defaultdata_Otp');
      schema.setCLP({ ...PUBLIC_CLP, protectedFields: { '*': ['Email'] } });
      await schema.update();

      await migration.up(Parse);

      expect((await readClp('defaultdata_Otp')).protectedFields).toEqual({ '*': ['Email'] });
    });

    it('is idempotent', async () => {
      await migration.up(Parse);
      await migration.up(Parse);

      expect(await readClp('_Role')).toEqual(jasmine.objectContaining(MASTER_ONLY_CLP));
    });

    it('creates a missing class already closed', async () => {
      await dropClass('Migration');

      await migration.up(Parse);

      expect(await classExists('Migration')).toBeTrue();
      const clp = await readClp('Migration');
      OPERATIONS.forEach(operation => expect(clp[operation]).toEqual({}));
    });

    it('keeps rows that server code writes later to a created class out of reach', async () => {
      await dropClass('defaultdata_Otp');
      await migration.up(Parse);
      const email = uniqueEmail('late');
      const session = (await createPlainUser(uniqueEmail('late-member'))).sessionToken;

      await issueOtp({ email });
      const row = await new Parse.Query('defaultdata_Otp').equalTo('Email', email).first(MASTER);

      for (const sessionToken of [undefined, session]) {
        const response = await rest('GET', `/classes/defaultdata_Otp/${row.id}`, { sessionToken });
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.data.code).toBe(OPERATION_FORBIDDEN);
      }
      await restoreOtpUniqueIndex();
    });

    it('does not hide unexpected schema errors', async () => {
      spyOn(Parse.Schema.prototype, 'get').and.rejectWith(new Error('database offline'));

      const failure = await captureRejection(migration.up(Parse));

      expect(failure.message).toBe('database offline');
    });

    it('warns that rolling back re-opens public access', async () => {
      const warn = spyOn(console, 'warn');
      await migration.up(Parse);

      await migration.down(Parse);

      expect(warn).toHaveBeenCalledOnceWith(REOPEN_WARNING);
    });

    it('restores public access on every class when rolled back', async () => {
      spyOn(console, 'warn');
      await migration.up(Parse);

      await migration.down(Parse);

      for (const className of LOCKED_CLASSES) {
        expect(await readClp(className)).toEqual(jasmine.objectContaining(PUBLIC_CLP));
      }
    });

    it('rolls back without failing when a class is missing', async () => {
      spyOn(console, 'warn');
      await dropClass('Migration');

      await expectAsync(migration.down(Parse)).toBeResolved();
    });
  });
});
