import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MongoClient } from 'mongodb';
import passwordUtils from 'parse-server/lib/password.js';
import { generateGuestPassword } from '../cloud/parsefunction/shared/createUserAccount.js';

const DEFAULT_DATABASE_URI = 'mongodb://localhost:27017/dev';

const buildEmailCandidates = email =>
  typeof email === 'string' && email.length > 0 ? [...new Set([email, email.toLowerCase()])] : [];

async function usesEmailAsPassword(account, comparePassword) {
  for (const candidate of buildEmailCandidates(account.email)) {
    if (await comparePassword(candidate, account._hashed_password)) {
      return true;
    }
  }
  return false;
}

async function findAccountsUsingEmailAsPassword(users, comparePassword) {
  const matchedIds = [];
  const cursor = users.find(
    { _hashed_password: { $exists: true } },
    { projection: { email: 1, _hashed_password: 1 } }
  );
  for await (const account of cursor) {
    if (await usesEmailAsPassword(account, comparePassword)) {
      matchedIds.push(account._id);
    }
  }
  return matchedIds;
}

async function rotateAccount({ users, sessions, hashPassword, generatePassword }, accountId) {
  const hashedPassword = await hashPassword(generatePassword());
  await users.updateOne(
    { _id: accountId },
    { $set: { _hashed_password: hashedPassword, _updated_at: new Date() } }
  );
  await sessions.deleteMany({ _p_user: `_User$${accountId}` });
}

export async function rotateGuestPasswords({ apply, ...dependencies }) {
  const matchedIds = await findAccountsUsingEmailAsPassword(
    dependencies.users,
    dependencies.comparePassword
  );
  if (apply) {
    for (const accountId of matchedIds) {
      await rotateAccount(dependencies, accountId);
    }
  }
  return { matchedIds, applied: apply };
}

const describeSummary = ({ matchedIds, applied }) =>
  [
    `${applied ? 'APPLIED' : 'DRY RUN'} matching accounts: ${matchedIds.length}`,
    ...matchedIds,
    '',
  ].join('\n');

export async function runGuestPasswordRotation({
  argv = process.argv.slice(2),
  env = process.env,
  connect = uri => new MongoClient(uri),
  passwords = passwordUtils,
  write = text => process.stdout.write(text),
} = {}) {
  const client = connect(env.DATABASE_URI || env.MONGODB_URI || DEFAULT_DATABASE_URI);
  await client.connect();
  try {
    const database = client.db();
    const summary = await rotateGuestPasswords({
      users: database.collection('_User'),
      sessions: database.collection('_Session'),
      comparePassword: passwords.compare,
      hashPassword: passwords.hash,
      generatePassword: generateGuestPassword,
      apply: argv.includes('--apply'),
    });
    write(describeSummary(summary));
    return summary;
  } finally {
    await client.close();
  }
}

const isExecutedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isExecutedDirectly) {
  await runGuestPasswordRotation();
}
