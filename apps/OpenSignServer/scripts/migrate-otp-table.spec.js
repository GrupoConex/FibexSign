import { MongoClient } from 'mongodb';
import {
  EMAIL_UNIQUE_INDEX,
  OTP_COLLECTION,
  migrateOtpTable,
  runOtpTableMigration,
} from './migrate-otp-table.js';

const TEST_DATABASE_URI = 'mongodb://localhost:27017/otp-migration-test';

const fakeCollection = ({ plaintextRows = 0, duplicateGroups = [] } = {}) => ({
  countDocuments: jasmine.createSpy('countDocuments').and.resolveTo(plaintextRows),
  aggregate: jasmine.createSpy('aggregate').and.returnValue({
    toArray: async () => duplicateGroups,
  }),
  updateMany: jasmine.createSpy('updateMany').and.resolveTo({}),
  deleteMany: jasmine.createSpy('deleteMany').and.resolveTo({}),
  createIndex: jasmine.createSpy('createIndex').and.resolveTo(EMAIL_UNIQUE_INDEX),
});

describe('migrate-otp-table', () => {
  describe('migrateOtpTable with an injected collection', () => {
    it('reports the pending work and writes nothing in dry-run mode', async () => {
      const collection = fakeCollection({
        plaintextRows: 4,
        duplicateGroups: [
          { _id: 'a@example.com', ids: ['new1', 'old1', 'old2'] },
          { _id: 'b@example.com', ids: ['new2', 'old3'] },
        ],
      });

      const summary = await migrateOtpTable({ collection, apply: false });

      expect(summary).toEqual({ plaintextRows: 4, duplicateRows: 3, applied: false });
      expect(collection.updateMany).not.toHaveBeenCalled();
      expect(collection.deleteMany).not.toHaveBeenCalled();
      expect(collection.createIndex).not.toHaveBeenCalled();
    });

    it('lets the duplicate search spill to disk on large collections', async () => {
      const collection = fakeCollection();

      await migrateOtpTable({ collection, apply: false });

      expect(collection.aggregate).toHaveBeenCalledWith(jasmine.any(Array), {
        allowDiskUse: true,
      });
    });

    it('unsets the plaintext otp, removes surplus duplicates and creates the unique index', async () => {
      const collection = fakeCollection({
        plaintextRows: 2,
        duplicateGroups: [{ _id: 'a@example.com', ids: ['new1', 'old1', 'old2'] }],
      });

      const summary = await migrateOtpTable({ collection, apply: true });

      expect(summary).toEqual({ plaintextRows: 2, duplicateRows: 2, applied: true });
      expect(collection.updateMany).toHaveBeenCalledWith(
        { OTP: { $exists: true } },
        { $unset: { OTP: '' } }
      );
      expect(collection.deleteMany).toHaveBeenCalledWith({ _id: { $in: ['old1', 'old2'] } });
      expect(collection.createIndex).toHaveBeenCalledWith(
        { Email: 1 },
        { unique: true, name: EMAIL_UNIQUE_INDEX }
      );
    });

    it('skips the writes that have nothing to do but still ensures the index', async () => {
      const collection = fakeCollection();

      const summary = await migrateOtpTable({ collection, apply: true });

      expect(summary).toEqual({ plaintextRows: 0, duplicateRows: 0, applied: true });
      expect(collection.updateMany).not.toHaveBeenCalled();
      expect(collection.deleteMany).not.toHaveBeenCalled();
      expect(collection.createIndex).toHaveBeenCalledTimes(1);
    });
  });

  describe('runOtpTableMigration command line behaviour', () => {
    const buildRun = (argv, collection) => {
      const output = [];
      const client = {
        connect: jasmine.createSpy('connect').and.resolveTo(),
        close: jasmine.createSpy('close').and.resolveTo(),
        db: () => ({ collection: name => (name === OTP_COLLECTION ? collection : undefined) }),
      };
      const connect = jasmine.createSpy('connect').and.returnValue(client);
      const write = text => output.push(text);
      return {
        output,
        client,
        connect,
        run: env => runOtpTableMigration({ argv, env, connect, write }),
      };
    };

    it('runs as a dry-run by default and prints only counts', async () => {
      const collection = fakeCollection({ plaintextRows: 3 });
      const { output, run, connect, client } = buildRun([], collection);

      const summary = await run({ DATABASE_URI: 'mongodb://db.example/app' });

      expect(connect).toHaveBeenCalledWith('mongodb://db.example/app');
      expect(summary.applied).toBeFalse();
      expect(output.join('')).toContain('DRY RUN');
      expect(output.join('')).toContain('plaintext rows: 3');
      expect(collection.updateMany).not.toHaveBeenCalled();
      expect(client.close).toHaveBeenCalledTimes(1);
    });

    it('applies the changes only with --apply', async () => {
      const collection = fakeCollection({ plaintextRows: 1 });
      const { output, run } = buildRun(['--apply'], collection);

      const summary = await run({ MONGODB_URI: 'mongodb://fallback.example/app' });

      expect(summary.applied).toBeTrue();
      expect(output.join('')).toContain('APPLIED');
      expect(collection.updateMany).toHaveBeenCalled();
    });

    it('falls back to the local development database when no uri is configured', async () => {
      const { run, connect } = buildRun([], fakeCollection());

      await run({});

      expect(connect).toHaveBeenCalledWith('mongodb://localhost:27017/dev');
    });

    it('closes the connection when the migration fails', async () => {
      const collection = fakeCollection();
      collection.countDocuments.and.rejectWith(new Error('mongo down'));
      const { run, client } = buildRun(['--apply'], collection);

      await expectAsync(run({})).toBeRejectedWithError('mongo down');

      expect(client.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('against a real mongo database', () => {
    let client;
    let collection;

    beforeEach(async () => {
      client = new MongoClient(TEST_DATABASE_URI);
      await client.connect();
      collection = client.db().collection(OTP_COLLECTION);
      await collection.deleteMany({});
      await collection.dropIndexes().catch(() => undefined);
    });

    afterEach(async () => {
      await client.db().dropDatabase();
      await client.close();
    });

    it('cleans legacy rows and makes duplicate emails impossible', async () => {
      await collection.insertMany([
        { _id: 'old', Email: 'dup@example.com', OTP: 1234, _updated_at: new Date(1000) },
        { _id: 'new', Email: 'dup@example.com', OTP: 5678, _updated_at: new Date(2000) },
        { _id: 'solo', Email: 'solo@example.com', OtpHash: 'hash', _updated_at: new Date(1500) },
      ]);

      const summary = await migrateOtpTable({ collection, apply: true });

      const remaining = await collection.find({}).sort({ _id: 1 }).toArray();
      expect(summary).toEqual({ plaintextRows: 2, duplicateRows: 1, applied: true });
      expect(remaining.map(row => row._id)).toEqual(['new', 'solo']);
      expect(remaining.every(row => row.OTP === undefined)).toBeTrue();
      await expectAsync(
        collection.insertOne({ _id: 'third', Email: 'solo@example.com' })
      ).toBeRejected();
    });

    it('is idempotent when applied twice', async () => {
      await collection.insertOne({ _id: 'only', Email: 'once@example.com', OTP: 1 });
      await migrateOtpTable({ collection, apply: true });

      const second = await migrateOtpTable({ collection, apply: true });

      expect(second).toEqual({ plaintextRows: 0, duplicateRows: 0, applied: true });
    });
  });
});
