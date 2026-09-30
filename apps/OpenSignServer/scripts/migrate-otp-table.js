import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MongoClient } from 'mongodb';

export const OTP_COLLECTION = 'defaultdata_Otp';
export const EMAIL_UNIQUE_INDEX = 'Email_unique';
const DEFAULT_DATABASE_URI = 'mongodb://localhost:27017/dev';

const findDuplicateGroups = collection =>
  collection
    .aggregate(
      [
        { $sort: { _updated_at: -1 } },
        { $group: { _id: '$Email', ids: { $push: '$_id' } } },
        { $match: { 'ids.1': { $exists: true } } },
      ],
      { allowDiskUse: true }
    )
    .toArray();

const collectSurplusIds = groups => groups.flatMap(group => group.ids.slice(1));

export async function migrateOtpTable({ collection, apply }) {
  const plaintextRows = await collection.countDocuments({ OTP: { $exists: true } });
  const surplusIds = collectSurplusIds(await findDuplicateGroups(collection));
  const summary = { plaintextRows, duplicateRows: surplusIds.length, applied: apply };
  if (!apply) {
    return summary;
  }
  if (plaintextRows > 0) {
    await collection.updateMany({ OTP: { $exists: true } }, { $unset: { OTP: '' } });
  }
  if (surplusIds.length > 0) {
    await collection.deleteMany({ _id: { $in: surplusIds } });
  }
  await collection.createIndex({ Email: 1 }, { unique: true, name: EMAIL_UNIQUE_INDEX });
  return summary;
}

const describeSummary = ({ plaintextRows, duplicateRows, applied }) =>
  `${applied ? 'APPLIED' : 'DRY RUN'} plaintext rows: ${plaintextRows} duplicate rows: ${duplicateRows}\n`;

export async function runOtpTableMigration({
  argv = process.argv.slice(2),
  env = process.env,
  connect = uri => new MongoClient(uri),
  write = text => process.stdout.write(text),
} = {}) {
  const client = connect(env.DATABASE_URI || env.MONGODB_URI || DEFAULT_DATABASE_URI);
  await client.connect();
  try {
    const collection = client.db().collection(OTP_COLLECTION);
    const summary = await migrateOtpTable({ collection, apply: argv.includes('--apply') });
    write(describeSummary(summary));
    return summary;
  } finally {
    await client.close();
  }
}

const isExecutedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isExecutedDirectly) {
  await runOtpTableMigration();
}
