import { createRequire } from 'node:module';
import axios from 'axios';
import { resetAuthState, silenceConsole, uniqueEmail } from '../utils/auth-fixtures.js';

const require = createRequire(import.meta.url);
const migration = require('../../databases/migrations/20261001120000-lock_user_create_clp.cjs');

const MASTER = { useMasterKey: true };
const PRODUCTION_CLP = {
  get: { '*': true },
  find: { '*': true },
  count: { '*': true },
  create: { '*': true },
  update: { '*': true },
  delete: {},
  addField: {},
};

const readClp = async () => (await new Parse.Schema('_User').get()).classLevelPermissions;

const applyClp = async classLevelPermissions => {
  const schema = new Parse.Schema('_User');
  schema.setCLP(classLevelPermissions);
  await schema.update();
};

const signUpPublicly = email =>
  axios.post(
    `${process.env.SERVER_URL}/users`,
    { username: email, email, password: 'Str0ngPassw0rd!' },
    {
      headers: {
        'X-Parse-Application-Id': process.env.APP_ID,
        'X-Parse-Javascript-Key': 'test',
      },
      validateStatus: () => true,
    }
  );

describe('_User create permission migration', () => {
  let originalClp;

  beforeAll(async () => {
    originalClp = await readClp();
  });

  beforeEach(async () => {
    silenceConsole();
    await resetAuthState();
    await applyClp(PRODUCTION_CLP);
  });

  afterAll(async () => {
    await applyClp(originalClp);
  });

  it('removes public creation and keeps every other permission as it was', async () => {
    await migration.up(Parse);

    const clp = await readClp();
    expect(clp.create).toEqual({});
    expect(clp.get).toEqual({ '*': true });
    expect(clp.find).toEqual({ '*': true });
    expect(clp.count).toEqual({ '*': true });
    expect(clp.update).toEqual({ '*': true });
    expect(clp.delete).toEqual({});
    expect(clp.addField).toEqual({});
  });

  it('makes the class refuse anonymous signup at the permission layer', async () => {
    await migration.up(Parse);

    const response = await signUpPublicly(uniqueEmail('migrated-signup'));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.data.code).toBe(Parse.Error.OPERATION_FORBIDDEN);
    expect(response.data.error).toContain('Permission denied');
  });

  it('keeps master key account creation working after the migration', async () => {
    await migration.up(Parse);
    const account = new Parse.User();
    account.set('username', uniqueEmail('migrated-master'));
    account.set('password', 'Str0ngPassw0rd!');

    const saved = await account.save(null, MASTER);

    expect(saved.id).toBeDefined();
  });

  it('is idempotent when run twice', async () => {
    await migration.up(Parse);
    await migration.up(Parse);

    expect((await readClp()).create).toEqual({});
  });

  it('warns that rolling back re-opens public signup', async () => {
    const warn = spyOn(console, 'warn');
    await migration.up(Parse);

    await migration.down(Parse);

    expect(warn).toHaveBeenCalledOnceWith(
      'Rolling back lock_user_create_clp re-opens public signup on _User'
    );
  });

  it('restores public creation when rolled back', async () => {
    await migration.up(Parse);
    await migration.down(Parse);

    const clp = await readClp();
    expect(clp.create).toEqual({ '*': true });
    expect(clp.find).toEqual({ '*': true });
  });
});
