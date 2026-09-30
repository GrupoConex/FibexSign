import { MongoClient } from 'mongodb';
import passwordUtils from 'parse-server/lib/password.js';
import { rotateGuestPasswords, runGuestPasswordRotation } from './rotate-guest-passwords.js';

const TEST_DATABASE_URI = 'mongodb://localhost:27017/guest-rotation-test';

const asyncCursor = documents => ({
  async *[Symbol.asyncIterator]() {
    yield* documents;
  },
});

const fakeCollections = rows => ({
  users: {
    find: jasmine.createSpy('find').and.callFake(() => asyncCursor(rows)),
    updateOne: jasmine.createSpy('updateOne').and.resolveTo({}),
  },
  sessions: { deleteMany: jasmine.createSpy('deleteMany').and.resolveTo({}) },
});

const buildDependencies = (rows, overrides = {}) => ({
  ...fakeCollections(rows),
  comparePassword: async (candidate, hash) => hash === `hash:${candidate}`,
  hashPassword: async password => `rehash:${password}`,
  generatePassword: () => 'random-password',
  apply: false,
  ...overrides,
});

const accounts = [
  { _id: 'guest1', email: 'guest1@example.com', _hashed_password: 'hash:guest1@example.com' },
  { _id: 'mixed', email: 'Mixed@Example.com', _hashed_password: 'hash:mixed@example.com' },
  { _id: 'real', email: 'real@example.com', _hashed_password: 'hash:something-else' },
  { _id: 'nohash', email: 'nohash@example.com' },
  { _id: 'noemail', _hashed_password: 'hash:undefined' },
];

describe('rotate-guest-passwords', () => {
  describe('rotateGuestPasswords with injected dependencies', () => {
    it('lists the accounts whose password is their email and writes nothing in dry-run mode', async () => {
      const dependencies = buildDependencies(accounts);

      const summary = await rotateGuestPasswords(dependencies);

      expect(summary).toEqual({ matchedIds: ['guest1', 'mixed'], applied: false });
      expect(dependencies.users.updateOne).not.toHaveBeenCalled();
      expect(dependencies.sessions.deleteMany).not.toHaveBeenCalled();
    });

    it('queries only accounts that have a password hash', async () => {
      const dependencies = buildDependencies(accounts);

      await rotateGuestPasswords(dependencies);

      expect(dependencies.users.find).toHaveBeenCalledWith(
        { _hashed_password: { $exists: true } },
        { projection: { email: 1, _hashed_password: 1 } }
      );
    });

    it('replaces the password with a random hash and revokes the sessions of each match', async () => {
      const dependencies = buildDependencies(accounts, { apply: true });

      const summary = await rotateGuestPasswords(dependencies);

      expect(summary).toEqual({ matchedIds: ['guest1', 'mixed'], applied: true });
      expect(dependencies.users.updateOne).toHaveBeenCalledTimes(2);
      expect(dependencies.users.updateOne).toHaveBeenCalledWith(
        { _id: 'guest1' },
        { $set: { _hashed_password: 'rehash:random-password', _updated_at: jasmine.any(Date) } }
      );
      expect(dependencies.sessions.deleteMany).toHaveBeenCalledWith({ _p_user: '_User$guest1' });
      expect(dependencies.sessions.deleteMany).toHaveBeenCalledWith({ _p_user: '_User$mixed' });
      expect(dependencies.sessions.deleteMany).toHaveBeenCalledTimes(2);
    });

    it('never touches accounts with a real password', async () => {
      const dependencies = buildDependencies(accounts, { apply: true });

      await rotateGuestPasswords(dependencies);

      const touchedIds = dependencies.users.updateOne.calls.allArgs().map(([filter]) => filter._id);
      expect(touchedIds).not.toContain('real');
      expect(touchedIds).not.toContain('nohash');
      expect(touchedIds).not.toContain('noemail');
    });

    it('generates a different password for every rotated account', async () => {
      let counter = 0;
      const dependencies = buildDependencies(accounts, {
        apply: true,
        generatePassword: () => `password-${(counter += 1)}`,
      });

      await rotateGuestPasswords(dependencies);

      const hashes = dependencies.users.updateOne.calls
        .allArgs()
        .map(([, update]) => update.$set._hashed_password);
      expect(new Set(hashes).size).toBe(2);
    });

    it('reports nothing when no account matches', async () => {
      const dependencies = buildDependencies([accounts[2]], { apply: true });

      const summary = await rotateGuestPasswords(dependencies);

      expect(summary).toEqual({ matchedIds: [], applied: true });
      expect(dependencies.users.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('runGuestPasswordRotation command line behaviour', () => {
    const buildRun = (argv, rows) => {
      const collections = fakeCollections(rows);
      const output = [];
      const client = {
        connect: jasmine.createSpy('connect').and.resolveTo(),
        close: jasmine.createSpy('close').and.resolveTo(),
        db: () => ({
          collection: name => (name === '_User' ? collections.users : collections.sessions),
        }),
      };
      const connect = jasmine.createSpy('connect').and.returnValue(client);
      const passwords = {
        compare: async (candidate, hash) => hash === `hash:${candidate}`,
        hash: async password => `rehash:${password}`,
      };
      return {
        output,
        client,
        connect,
        collections,
        run: env =>
          runGuestPasswordRotation({
            argv,
            env,
            connect,
            passwords,
            write: text => output.push(text),
          }),
      };
    };

    it('is a dry-run by default and prints only a count and ids', async () => {
      const { output, run, connect, client, collections } = buildRun([], accounts);

      const summary = await run({ DATABASE_URI: 'mongodb://db.example/app' });

      const printed = output.join('');
      expect(connect).toHaveBeenCalledWith('mongodb://db.example/app');
      expect(summary.applied).toBeFalse();
      expect(printed).toContain('DRY RUN matching accounts: 2');
      expect(printed).toContain('guest1');
      expect(printed).not.toContain('@');
      expect(printed).not.toContain('hash');
      expect(collections.users.updateOne).not.toHaveBeenCalled();
      expect(client.close).toHaveBeenCalledTimes(1);
    });

    it('applies the rotation only with --apply and never prints secrets', async () => {
      const { output, run, collections } = buildRun(['--apply'], accounts);

      const summary = await run({ MONGODB_URI: 'mongodb://fallback.example/app' });

      const printed = output.join('');
      expect(summary.applied).toBeTrue();
      expect(printed).toContain('APPLIED matching accounts: 2');
      expect(printed).not.toContain('@');
      expect(printed).not.toContain('rehash');
      expect(collections.users.updateOne).toHaveBeenCalledTimes(2);
    });

    it('falls back to the local development database', async () => {
      const { run, connect } = buildRun([], []);

      await run({});

      expect(connect).toHaveBeenCalledWith('mongodb://localhost:27017/dev');
    });

    it('closes the connection when the rotation fails', async () => {
      const { run, client, collections } = buildRun(['--apply'], accounts);
      collections.users.find.and.throwError('mongo down');

      await expectAsync(run({})).toBeRejectedWithError('mongo down');

      expect(client.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('against a real mongo database with the bcrypt used by parse server', () => {
    let client;

    const users = () => client.db().collection('_User');
    const sessions = () => client.db().collection('_Session');

    const insertUser = async (id, email, password) =>
      users().insertOne({ _id: id, email, _hashed_password: await passwordUtils.hash(password) });

    beforeEach(async () => {
      client = new MongoClient(TEST_DATABASE_URI);
      await client.connect();
      await insertUser('guest', 'guest@example.com', 'guest@example.com');
      await insertUser('member', 'member@example.com', 'Real-Passw0rd!');
      await users().insertOne({ _id: 'legacy', email: 'legacy@example.com' });
      await sessions().insertMany([
        { _id: 's1', _p_user: '_User$guest' },
        { _id: 's2', _p_user: '_User$guest' },
        { _id: 's3', _p_user: '_User$member' },
      ]);
    });

    afterEach(async () => {
      await client.db().dropDatabase();
      await client.close();
    });

    const run = argv =>
      runGuestPasswordRotation({
        argv,
        env: { DATABASE_URI: TEST_DATABASE_URI },
        write: () => undefined,
      });

    it('changes nothing in dry-run mode', async () => {
      const before = await users().findOne({ _id: 'guest' });

      const summary = await run([]);

      const after = await users().findOne({ _id: 'guest' });
      expect(summary.matchedIds).toEqual(['guest']);
      expect(after._hashed_password).toBe(before._hashed_password);
      expect(await sessions().countDocuments({})).toBe(3);
    });

    it('rotates only the guest account and removes only its sessions', async () => {
      const member = await users().findOne({ _id: 'member' });

      await run(['--apply']);

      const guest = await users().findOne({ _id: 'guest' });
      const remainingSessions = await sessions().find({}).toArray();
      expect(await passwordUtils.compare('guest@example.com', guest._hashed_password)).toBeFalse();
      expect((await users().findOne({ _id: 'member' }))._hashed_password).toBe(
        member._hashed_password
      );
      expect(remainingSessions.map(session => session._id)).toEqual(['s3']);
    });

    it('finds nothing to rotate on a second run', async () => {
      await run(['--apply']);

      const second = await run(['--apply']);

      expect(second.matchedIds).toEqual([]);
    });
  });
});
