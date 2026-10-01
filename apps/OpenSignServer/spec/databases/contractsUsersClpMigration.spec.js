import { createRequire } from 'node:module';
import axios from 'axios';
import {
  createPlainUser,
  pointer,
  resetAuthState,
  silenceConsole,
  uniqueEmail,
} from '../utils/auth-fixtures.js';

const require = createRequire(import.meta.url);
const migration = require('../../databases/migrations/20260930120000-lock_contracts_users_create_clp.cjs');

const MASTER = { useMasterKey: true };
const PRODUCTION_CLP = {
  get: {},
  find: {},
  count: {},
  create: { '*': true },
  update: { '*': true },
  delete: {},
  addField: {},
};

const readClp = async () => (await new Parse.Schema('contracts_Users').get()).classLevelPermissions;

const applyClp = async classLevelPermissions => {
  const schema = new Parse.Schema('contracts_Users');
  schema.setCLP(classLevelPermissions);
  await schema.update();
};

const forgeRow = (account, sessionToken) =>
  axios.post(
    `${process.env.SERVER_URL}/classes/contracts_Users`,
    { UserRole: 'contracts_Admin', UserId: pointer('_User', account.id) },
    {
      headers: {
        'X-Parse-Application-Id': process.env.APP_ID,
        'X-Parse-Javascript-Key': 'test',
        'X-Parse-Session-Token': sessionToken,
      },
      validateStatus: () => true,
    }
  );

describe('contracts_Users create permission migration', () => {
  beforeAll(async () => {
    const seed = new Parse.Object('contracts_Users');
    seed.set('UserRole', 'seed');
    seed.set('UserId', pointer('_User', 'seed'));
    await seed.save(null, MASTER);
    await seed.destroy(MASTER);
  });

  beforeEach(async () => {
    silenceConsole();
    await resetAuthState();
    await applyClp(PRODUCTION_CLP);
  });

  afterAll(async () => {
    await applyClp(
      Object.fromEntries(Object.keys(PRODUCTION_CLP).map(operation => [operation, { '*': true }]))
    );
  });

  it('removes public creation and keeps every other permission as it was', async () => {
    await migration.up(Parse);

    const clp = await readClp();
    expect(clp.create).toEqual({});
    expect(clp.update).toEqual({ '*': true });
    expect(clp.find).toEqual({});
    expect(clp.get).toEqual({});
    expect(clp.delete).toEqual({});
    expect(clp.addField).toEqual({});
  });

  it('makes the class refuse client creation at the permission layer', async () => {
    await migration.up(Parse);
    const attacker = await createPlainUser(uniqueEmail('migrated-forger'));

    const response = await forgeRow(attacker, attacker.sessionToken);

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.data.code).toBe(Parse.Error.OPERATION_FORBIDDEN);
  });

  it('keeps master key creation working after the migration', async () => {
    await migration.up(Parse);
    const row = new Parse.Object('contracts_Users');
    row.set('UserRole', 'contracts_User');

    const saved = await row.save(null, MASTER);

    expect(saved.id).toBeDefined();
  });

  it('is idempotent when run twice', async () => {
    await migration.up(Parse);
    await migration.up(Parse);

    expect((await readClp()).create).toEqual({});
  });

  it('restores public creation when rolled back', async () => {
    await migration.up(Parse);
    await migration.down(Parse);

    const clp = await readClp();
    expect(clp.create).toEqual({ '*': true });
    expect(clp.find).toEqual({});
  });
});
