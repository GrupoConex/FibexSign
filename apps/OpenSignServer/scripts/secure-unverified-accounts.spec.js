import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MongoClient } from 'mongodb';
import passwordUtils from 'parse-server/lib/password.js';
import {
  maskEmail,
  parseLimit,
  exitCodeFor,
  secureUnverifiedAccounts,
  runSecureUnverifiedAccounts,
} from './secure-unverified-accounts.js';

const TEST_DATABASE_URI = 'mongodb://localhost:27017/secure-unverified-test';
const EARLY = new Date('2024-01-01T00:00:00Z');
const LATE = new Date('2024-06-01T00:00:00Z');
const NOW = new Date('2025-01-01T00:00:00Z');

describe('secure-unverified-accounts', () => {
  let client;
  const collection = name => client.db().collection(name);

  const insertUser = async (id, extra = {}) =>
    collection('_User').insertOne({
      _id: id,
      email: `${id}@example.com`,
      _created_at: LATE,
      _hashed_password: await passwordUtils.hash('Known-Passw0rd!'),
      ...extra,
    });
  const makeOwner = id => collection('partners_Tenant').insertOne({ _p_UserId: `_User$${id}` });
  const makeMember = (id, extra = {}) =>
    collection('contracts_Users').insertOne({ _p_UserId: `_User$${id}`, ...extra });
  const addContact = (id, createdAt = LATE) =>
    collection('contracts_Contactbook').insertOne({
      _p_UserId: `_User$${id}`,
      _created_at: createdAt,
    });
  const addSession = (sessionId, userId, authProvider) =>
    collection('_Session').insertOne({
      _id: sessionId,
      _p_user: `_User$${userId}`,
      createdWith: { action: 'login', authProvider },
    });

  const run = (options = {}) =>
    secureUnverifiedAccounts({
      database: client.db(),
      apply: false,
      hashPassword: async password => `rehash:${password}`,
      generatePassword: () => 'random-password',
      now: () => NOW,
      ...options,
    });

  const classOf = (summary, id) => summary.flagged.find(entry => entry.id === id)?.class;

  beforeEach(async () => {
    client = new MongoClient(TEST_DATABASE_URI);
    await client.connect();
    await insertUser('owner');
    await makeOwner('owner');
    await insertUser('member', { _auth_data_anonymous: { id: 'x' } });
    await makeMember('member');
    await insertUser('guest', { _auth_data_anonymous: { id: 'g' }, _created_at: EARLY });
    await addContact('guest', LATE);
    await insertUser('verified', { emailVerified: true });
    await addContact('verified', LATE);
    await insertUser('stranger');
    await addSession('s-owner', 'owner', 'password');
    await addSession('s-member-pw', 'member', 'password');
    await addSession('s-member-master', 'member', 'masterkey');
    await addSession('s-guest', 'guest', 'password');
    await addSession('s-verified', 'verified', 'password');
  });

  afterEach(async () => {
    await client.db().dropDatabase();
    await client.close();
  });

  describe('classification and indicators', () => {
    it('classifies owner, member and guest and skips verified and unreferenced accounts', async () => {
      const summary = await run();

      expect(summary.counts).toEqual(
        jasmine.objectContaining({ scanned: 4, owners: 1, members: 1, guests: 1, ignored: 1 })
      );
      expect(classOf(summary, 'owner')).toBe('owner');
      expect(classOf(summary, 'member')).toBe('member');
      expect(classOf(summary, 'guest')).toBe('guest');
      expect(summary.flagged.map(entry => entry.id)).not.toContain('verified');
    });

    it('computes the indicators of compromise per account', async () => {
      const summary = await run();

      const guest = summary.flagged.find(entry => entry.id === 'guest');
      const member = summary.flagged.find(entry => entry.id === 'member');
      expect(guest.indicators).toEqual(['preRegistered', 'passwordSession', 'authData']);
      expect(member.indicators).toEqual(['passwordSession', 'authData']);
      expect(summary.indicators).toEqual({ preRegistered: 1, passwordSession: 3, authData: 2 });
    });

    it('does not flag pre-registration when the account is newer than its contact rows', async () => {
      await collection('_User').updateOne({ _id: 'guest' }, { $set: { _created_at: LATE } });
      await collection('contracts_Contactbook').updateOne(
        { _p_UserId: '_User$guest' },
        { $set: { _created_at: EARLY } }
      );

      const flagged = (await run()).flagged.find(entry => entry.id === 'guest');

      expect(flagged.indicators).not.toContain('preRegistered');
    });

    it('does not flag accounts without indicators', async () => {
      await collection('_Session').deleteMany({ _p_user: '_User$member' });
      await collection('_User').updateOne(
        { _id: 'member' },
        { $unset: { _auth_data_anonymous: '' } }
      );

      const summary = await run();

      expect(summary.flagged.map(entry => entry.id)).not.toContain('member');
      expect(summary.counts.members).toBe(1);
    });

    it('treats a disabled membership as no membership', async () => {
      await collection('contracts_Users').updateOne({}, { $set: { IsDisabled: true } });

      const summary = await run();

      expect(summary.counts.members).toBe(0);
      expect(summary.counts.ignored).toBe(2);
    });

    it('treats an account with a linked-account row but no active membership as a guest', async () => {
      await insertUser('linked');
      await makeMember('linked', { IsLinkedAccount: true, IsDisabled: true });

      const summary = await run();

      expect(summary.counts.guests).toBe(2);
    });

    it('reads authData stored as a nested object too', async () => {
      await collection('_User').updateOne(
        { _id: 'stranger' },
        { $set: { authData: { anonymous: { id: 'n' } } } }
      );
      await addContact('stranger');

      const summary = await run();

      expect(summary.flagged.find(entry => entry.id === 'stranger').indicators).toContain(
        'authData'
      );
    });

    it('honours the scan limit', async () => {
      const summary = await run({ limit: 2 });

      expect(summary.counts.scanned).toBe(2);
    });
  });

  describe('dry run', () => {
    it('writes nothing', async () => {
      const usersBefore = await collection('_User').find({}).toArray();

      const summary = await run();

      expect(summary.applied).toBeFalse();
      expect(await collection('_User').find({}).toArray()).toEqual(usersBefore);
      expect(await collection('_Session').countDocuments({})).toBe(5);
      expect(summary.changes).toEqual({ membersRevoked: 0, guestsSecured: 0 });
    });
  });

  describe('apply', () => {
    it('never modifies owners', async () => {
      const before = await collection('_User').findOne({ _id: 'owner' });

      await run({ apply: true });

      expect(await collection('_User').findOne({ _id: 'owner' })).toEqual(before);
      expect(await collection('_Session').countDocuments({ _p_user: '_User$owner' })).toBe(1);
    });

    it('revokes every session of a member and leaves password and authData untouched', async () => {
      const before = await collection('_User').findOne({ _id: 'member' });

      const summary = await run({ apply: true });

      expect(await collection('_Session').countDocuments({ _p_user: '_User$member' })).toBe(0);
      expect(await collection('_User').findOne({ _id: 'member' })).toEqual(before);
      expect(summary.changes.membersRevoked).toBe(1);
    });

    it('rotates the password, removes authData and revokes sessions of a guest', async () => {
      const summary = await run({ apply: true });

      const guest = await collection('_User').findOne({ _id: 'guest' });
      expect(guest._hashed_password).toBe('rehash:random-password');
      expect(guest._auth_data_anonymous).toBeUndefined();
      expect(guest.credentialsSecuredAt).toEqual(NOW);
      expect(await collection('_Session').countDocuments({ _p_user: '_User$guest' })).toBe(0);
      expect(summary.changes.guestsSecured).toBe(1);
    });

    it('invalidates the old password of a guest with the real hasher', async () => {
      await run({ apply: true, hashPassword: passwordUtils.hash });

      const guest = await collection('_User').findOne({ _id: 'guest' });
      expect(await passwordUtils.compare('Known-Passw0rd!', guest._hashed_password)).toBeFalse();
    });

    it('also unsets nested authData of a guest', async () => {
      await collection('_User').updateOne(
        { _id: 'guest' },
        { $set: { authData: { a: { id: 1 } } } }
      );

      await run({ apply: true });

      expect((await collection('_User').findOne({ _id: 'guest' })).authData).toBeUndefined();
    });

    it('leaves verified accounts and their sessions alone', async () => {
      await run({ apply: true });

      expect(await collection('_Session').countDocuments({ _p_user: '_User$verified' })).toBe(1);
      expect(
        (await collection('_User').findOne({ _id: 'verified' }))._hashed_password
      ).not.toContain('rehash');
    });

    it('is idempotent: a second run changes nothing new', async () => {
      await run({ apply: true });
      const afterFirst = await collection('_User').find({}).toArray();

      const second = await run({ apply: true, now: () => new Date('2026-01-01T00:00:00Z') });

      expect(await collection('_User').find({}).toArray()).toEqual(afterFirst);
      expect(second.changes).toEqual({ membersRevoked: 0, guestsSecured: 0 });
      expect(second.flagged.map(entry => entry.id)).toEqual(['member', 'owner']);
    });
  });

  describe('hardening', () => {
    const databaseWith = sessions => ({
      collection: name => (name === '_Session' ? sessions : collection(name)),
    });

    it('sets the secured marker only after the sessions are deleted', async () => {
      const markersAtSessionDeletion = [];
      const sessions = collection('_Session');
      const originalDeleteMany = sessions.deleteMany.bind(sessions);
      spyOn(sessions, 'deleteMany').and.callFake(async filter => {
        const userId = filter._p_user.replace('_User$', '');
        const user = await collection('_User').findOne({ _id: userId });
        markersAtSessionDeletion.push(user.credentialsSecuredAt);
        return originalDeleteMany(filter);
      });

      await run({ apply: true, database: databaseWith(sessions) });

      expect(markersAtSessionDeletion).toEqual([undefined, undefined]);
      expect((await collection('_User').findOne({ _id: 'guest' })).credentialsSecuredAt).toEqual(
        NOW
      );
    });

    it('secures the guest on a rerun after a failure between the steps', async () => {
      const sessions = collection('_Session');
      const deletion = spyOn(sessions, 'deleteMany').and.rejectWith(new Error('crash'));

      const failedRun = await run({ apply: true, database: databaseWith(sessions) });
      deletion.and.callThrough();
      const rerun = await run({ apply: true });

      expect(failedRun.failed.map(entry => entry.id)).toContain('guest');
      expect(rerun.changes.guestsSecured).toBe(1);
      expect(await collection('_Session').countDocuments({ _p_user: '_User$guest' })).toBe(0);
    });

    it('continues after a failing account, reporting its id and masked email only', async () => {
      let attempts = 0;

      const summary = await run({
        apply: true,
        hashPassword: async () => {
          attempts += 1;
          throw new Error('boom guest@example.com');
        },
      });

      expect(attempts).toBe(1);
      expect(summary.failed).toEqual([{ id: 'guest', email: 'g***@example.com' }]);
      expect(summary.changes.membersRevoked).toBe(1);
      expect(exitCodeFor(summary)).toBe(1);
    });

    it('exits zero when nothing failed', async () => {
      expect(exitCodeFor(await run())).toBe(0);
    });

    it('advances past already secured guests between consecutive limited runs', async () => {
      const first = await run({ apply: true, limit: 1 });
      const second = await run({ apply: true, limit: 1 });

      expect(first.counts.guests).toBe(1);
      expect(second.counts.guests).toBe(0);
      expect(second.counts.members).toBe(1);
      expect(second.counts.alreadySecured).toBe(1);
    });

    it('counts secured accounts separately from the scan', async () => {
      await run({ apply: true });

      const second = await run();

      expect(second.counts.alreadySecured).toBe(1);
      expect(second.counts.scanned).toBe(3);
    });
  });

  describe('helpers', () => {
    it('masks emails', () => {
      expect(maskEmail('john@domain.com')).toBe('j***@domain.com');
      expect(maskEmail('a')).toBe('***');
      expect(maskEmail(undefined)).toBe('***');
      expect(maskEmail('@x.com')).toBe('***');
    });

    it('parses the limit option', () => {
      expect(parseLimit(['--limit=25'])).toBe(25);
      expect(parseLimit(['--apply'])).toBe(0);
      expect(parseLimit(['--limit=abc'])).toBe(0);
    });
  });

  describe('runSecureUnverifiedAccounts command line behaviour', () => {
    const exec = (argv, env = { DATABASE_URI: TEST_DATABASE_URI }) => {
      const output = [];
      return runSecureUnverifiedAccounts({ argv, env, write: text => output.push(text) }).then(
        summary => ({ summary, printed: output.join('') })
      );
    };

    it('defaults to dry run and prints masked emails with no hashes or raw emails', async () => {
      const { summary, printed } = await exec([]);

      expect(summary.applied).toBeFalse();
      expect(printed).toContain('DRY RUN');
      expect(printed).toContain('g***@example.com');
      expect(printed).not.toContain('guest@example.com');
      expect(printed).not.toContain('$2');
      expect(await collection('_Session').countDocuments({})).toBe(5);
    });

    it('applies only with --apply', async () => {
      const { printed } = await exec(['--apply']);

      expect(printed).toContain('APPLIED');
      expect(await collection('_Session').countDocuments({ _p_user: '_User$guest' })).toBe(0);
    });

    it('uses the injected connection factory and closes the client', async () => {
      const real = new MongoClient(TEST_DATABASE_URI);
      const close = spyOn(real, 'close').and.callThrough();
      const connect = jasmine.createSpy('connect').and.returnValue(real);

      await runSecureUnverifiedAccounts({
        argv: [],
        env: { MONGODB_URI: TEST_DATABASE_URI },
        connect,
        write: () => undefined,
      });

      expect(connect).toHaveBeenCalledWith(TEST_DATABASE_URI);
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('falls back to the local development database', async () => {
      const connect = jasmine.createSpy('connect').and.callFake(() => {
        throw new Error('stop');
      });

      await expectAsync(
        runSecureUnverifiedAccounts({ argv: [], env: {}, connect, write: () => undefined })
      ).toBeRejectedWithError('stop');

      expect(connect).toHaveBeenCalledWith('mongodb://localhost:27017/dev');
    });

    it('runs as a standalone process with default wiring', async () => {
      const { stdout } = await promisify(execFile)(
        process.execPath,
        ['scripts/secure-unverified-accounts.js'],
        { env: { ...process.env, DATABASE_URI: TEST_DATABASE_URI } }
      );

      expect(stdout).toContain('DRY RUN unverified accounts scanned: 4');
      expect(await collection('_Session').countDocuments({})).toBe(5);
    });

    it('refuses --apply without an explicit database uri and never connects', async () => {
      const connect = jasmine.createSpy('connect');

      await expectAsync(
        runSecureUnverifiedAccounts({ argv: ['--apply'], env: {}, connect, write: () => undefined })
      ).toBeRejectedWithError(/DATABASE_URI/);

      expect(connect).not.toHaveBeenCalled();
    });

    it('states that disabled-only members are treated as guests', async () => {
      const { printed } = await exec([]);

      expect(printed).toContain('disabled-only members are treated as guests');
      expect(printed).toContain('failed accounts: 0');
    });

    it('closes the connection when the scan fails', async () => {
      const failing = {
        connect: async () => undefined,
        close: jasmine.createSpy('close').and.resolveTo(),
        db: () => {
          throw new Error('mongo down');
        },
      };

      await expectAsync(
        runSecureUnverifiedAccounts({
          argv: [],
          env: {},
          connect: () => failing,
          write: () => undefined,
        })
      ).toBeRejectedWithError('mongo down');
      expect(failing.close).toHaveBeenCalledTimes(1);
    });
  });
});
