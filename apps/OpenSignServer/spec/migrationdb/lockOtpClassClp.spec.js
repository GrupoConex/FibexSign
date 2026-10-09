import { MongoClient } from 'mongodb';
import lockOtpClassClp, { OTP_CLASS_PERMISSIONS } from '../../migrationdb/lockOtpClassClp.js';

const URI = 'mongodb://localhost:27017/parse-test';
const OTP_CLASS = 'defaultdata_Otp';
const OPERATIONS = ['get', 'find', 'count', 'create', 'update', 'delete', 'addField'];
const OPEN_PERMISSIONS = Object.fromEntries(
  OPERATIONS.map(operation => [operation, { '*': true }])
);

describe('lockOtpClassClp startup step', () => {
  let client;
  let schemaCollection;
  let savedDocument;

  beforeEach(async () => {
    client = new MongoClient(URI);
    await client.connect();
    schemaCollection = client.db().collection('_SCHEMA');
    savedDocument = await schemaCollection.findOne({ _id: OTP_CLASS });
  });

  afterEach(async () => {
    await schemaCollection.deleteOne({ _id: OTP_CLASS });
    if (savedDocument) {
      await schemaCollection.insertOne(savedDocument);
    }
    await client.close();
  });

  const readPermissions = async () =>
    (await schemaCollection.findOne({ _id: OTP_CLASS }))._metadata.class_permissions;

  it('registers the class closed when the schema has no entry for it', async () => {
    await schemaCollection.deleteOne({ _id: OTP_CLASS });

    await lockOtpClassClp({ uri: URI });

    expect(await readPermissions()).toEqual(OTP_CLASS_PERMISSIONS);
    OPERATIONS.forEach(operation => expect(OTP_CLASS_PERMISSIONS[operation]).toEqual({}));
  });

  it('closes an entry that was left open and keeps its fields', async () => {
    await schemaCollection.updateOne(
      { _id: OTP_CLASS },
      { $set: { Email: 'string', '_metadata.class_permissions': OPEN_PERMISSIONS } },
      { upsert: true }
    );

    await lockOtpClassClp({ uri: URI });

    const document = await schemaCollection.findOne({ _id: OTP_CLASS });
    expect(document._metadata.class_permissions).toEqual(OTP_CLASS_PERMISSIONS);
    expect(document.Email).toBe('string');
  });

  it('is idempotent', async () => {
    await lockOtpClassClp({ uri: URI });
    const first = await schemaCollection.findOne({ _id: OTP_CLASS });

    await lockOtpClassClp({ uri: URI });

    expect(await schemaCollection.findOne({ _id: OTP_CLASS })).toEqual(first);
  });
});
