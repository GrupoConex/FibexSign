import { MongoClient } from 'mongodb';

const OTP_CLASS = 'defaultdata_Otp';
const DEFAULT_DATABASE_URI = 'mongodb://localhost:27017/dev';
const OPERATIONS = ['get', 'find', 'count', 'create', 'update', 'delete', 'addField'];

export const OTP_CLASS_PERMISSIONS = Object.freeze(
  Object.fromEntries(OPERATIONS.map(operation => [operation, {}]))
);

const resolveUri = () =>
  process.env.DATABASE_URI || process.env.MONGODB_URI || DEFAULT_DATABASE_URI;

export default async function lockOtpClassClp({ uri = resolveUri() } = {}) {
  const client = new MongoClient(uri);
  await client.connect();
  try {
    await client
      .db()
      .collection('_SCHEMA')
      .updateOne(
        { _id: OTP_CLASS },
        {
          $set: { '_metadata.class_permissions': OTP_CLASS_PERMISSIONS },
          $setOnInsert: { objectId: 'string', updatedAt: 'date', createdAt: 'date' },
        },
        { upsert: true }
      );
  } finally {
    await client.close();
  }
}
