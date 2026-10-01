import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MongoClient } from 'mongodb';
import passwordUtils from 'parse-server/lib/password.js';
import { generateGuestPassword } from '../cloud/parsefunction/shared/guestPassword.js';

const DEFAULT_DATABASE_URI = 'mongodb://localhost:27017/dev';
const SCAN_BATCH_SIZE = 500;
const AUTH_DATA_FIELD_PREFIX = '_auth_data_';
const PASSWORD_PROVIDER = 'password';
const LIMIT_OPTION_PREFIX = '--limit=';
const MASKED_PLACEHOLDER = '***';

export const ACCOUNT_CLASS = Object.freeze({
  OWNER: 'owner',
  MEMBER: 'member',
  GUEST: 'guest',
  IGNORED: 'ignored',
});

export function maskEmail(email) {
  if (typeof email !== 'string') {
    return MASKED_PLACEHOLDER;
  }
  const separatorIndex = email.indexOf('@');
  if (separatorIndex < 1) {
    return MASKED_PLACEHOLDER;
  }
  return `${email[0]}${MASKED_PLACEHOLDER}${email.slice(separatorIndex)}`;
}

export function parseLimit(argv) {
  const option = argv.find(argument => argument.startsWith(LIMIT_OPTION_PREFIX));
  const limit = Number.parseInt(option?.slice(LIMIT_OPTION_PREFIX.length), 10);
  return Number.isInteger(limit) && limit > 0 ? limit : 0;
}

const toUserReference = userId => `_User$${userId}`;

const findAuthDataFields = account => {
  const flatFields = Object.keys(account).filter(field => field.startsWith(AUTH_DATA_FIELD_PREFIX));
  return account.authData ? [...flatFields, 'authData'] : flatFields;
};

async function classifyAccount(database, account) {
  const reference = toUserReference(account._id);
  if (await database.collection('partners_Tenant').findOne({ _p_UserId: reference })) {
    return ACCOUNT_CLASS.OWNER;
  }
  const activeMembership = { _p_UserId: reference, IsDisabled: { $ne: true } };
  if (await database.collection('contracts_Users').findOne(activeMembership)) {
    return ACCOUNT_CLASS.MEMBER;
  }
  const isReferencedAsContact = await database
    .collection('contracts_Contactbook')
    .findOne({ _p_UserId: reference });
  const hasLinkedRow = await database
    .collection('contracts_Users')
    .findOne({ _p_UserId: reference, IsLinkedAccount: true });
  return isReferencedAsContact || hasLinkedRow ? ACCOUNT_CLASS.GUEST : ACCOUNT_CLASS.IGNORED;
}

async function wasCreatedBeforeFirstContact(database, account) {
  const [firstContact] = await database
    .collection('contracts_Contactbook')
    .find({ _p_UserId: toUserReference(account._id) })
    .sort({ _created_at: 1 })
    .limit(1)
    .toArray();
  return Boolean(firstContact?._created_at && account._created_at < firstContact._created_at);
}

const hasPasswordSession = (database, account) =>
  database
    .collection('_Session')
    .findOne({
      _p_user: toUserReference(account._id),
      'createdWith.authProvider': PASSWORD_PROVIDER,
    })
    .then(Boolean);

async function collectIndicators(database, account) {
  const checks = [
    ['preRegistered', () => wasCreatedBeforeFirstContact(database, account)],
    ['passwordSession', () => hasPasswordSession(database, account)],
    ['authData', async () => findAuthDataFields(account).length > 0],
  ];
  const indicators = [];
  for (const [name, check] of checks) {
    if (await check()) {
      indicators.push(name);
    }
  }
  return indicators;
}

const revokeAllSessions = async (database, account) => {
  const { deletedCount } = await database
    .collection('_Session')
    .deleteMany({ _p_user: toUserReference(account._id) });
  return deletedCount;
};

async function secureGuest(database, account, { hashPassword, generatePassword, now }) {
  const unsetFields = Object.fromEntries(findAuthDataFields(account).map(field => [field, '']));
  const update = {
    $set: { _hashed_password: await hashPassword(generatePassword()), _updated_at: now() },
    ...(Object.keys(unsetFields).length > 0 && { $unset: unsetFields }),
  };
  const users = database.collection('_User');
  await users.updateOne({ _id: account._id }, update);
  await revokeAllSessions(database, account);
  await users.updateOne({ _id: account._id }, { $set: { credentialsSecuredAt: now() } });
}

const UNVERIFIED_FILTER = { emailVerified: { $ne: true } };
const NOT_YET_SECURED_FILTER = { ...UNVERIFIED_FILTER, credentialsSecuredAt: { $exists: false } };
const ALREADY_SECURED_FILTER = { ...UNVERIFIED_FILTER, credentialsSecuredAt: { $exists: true } };

export const exitCodeFor = ({ failed }) => (failed.length > 0 ? 1 : 0);

const emptyCounts = () => ({
  scanned: 0,
  owners: 0,
  members: 0,
  guests: 0,
  alreadySecured: 0,
  ignored: 0,
});

const COUNT_KEY_BY_CLASS = {
  [ACCOUNT_CLASS.OWNER]: 'owners',
  [ACCOUNT_CLASS.MEMBER]: 'members',
  [ACCOUNT_CLASS.GUEST]: 'guests',
  [ACCOUNT_CLASS.IGNORED]: 'ignored',
};

async function applyRemediation(database, account, accountClass, options, changes) {
  if (accountClass === ACCOUNT_CLASS.MEMBER) {
    changes.membersRevoked += (await revokeAllSessions(database, account)) > 0 ? 1 : 0;
  }
  if (accountClass === ACCOUNT_CLASS.GUEST) {
    await secureGuest(database, account, options);
    changes.guestsSecured += 1;
  }
}

export async function secureUnverifiedAccounts({ database, apply, limit = 0, ...options }) {
  const tally = {
    counts: emptyCounts(),
    indicators: { preRegistered: 0, passwordSession: 0, authData: 0 },
    changes: { membersRevoked: 0, guestsSecured: 0 },
    flagged: [],
    failed: [],
  };
  tally.counts.alreadySecured = await database
    .collection('_User')
    .countDocuments(ALREADY_SECURED_FILTER);
  const cursor = database
    .collection('_User')
    .find(NOT_YET_SECURED_FILTER)
    .sort({ _id: 1 })
    .limit(limit)
    .batchSize(SCAN_BATCH_SIZE);

  for await (const account of cursor) {
    tally.counts.scanned += 1;
    try {
      await processAccount({ database, account, apply, options, tally });
    } catch {
      tally.failed.push({ id: account._id, email: maskEmail(account.email) });
    }
  }
  return { applied: apply, ...tally };
}

async function processAccount({ database, account, apply, options, tally }) {
  const accountClass = await classifyAccount(database, account);
  tally.counts[COUNT_KEY_BY_CLASS[accountClass]] += 1;
  if (accountClass === ACCOUNT_CLASS.IGNORED) {
    return;
  }
  const indicators = await collectIndicators(database, account);
  indicators.forEach(indicator => (tally.indicators[indicator] += 1));
  if (indicators.length > 0) {
    tally.flagged.push({
      id: account._id,
      email: maskEmail(account.email),
      class: accountClass,
      indicators,
    });
  }
  if (apply) {
    await applyRemediation(database, account, accountClass, options, tally.changes);
  }
}

const describeSummary = ({ applied, counts, indicators, changes, flagged, failed }) =>
  [
    `${applied ? 'APPLIED' : 'DRY RUN'} unverified accounts scanned: ${counts.scanned}`,
    `owners (report only): ${counts.owners}`,
    `members: ${counts.members}`,
    `guests: ${counts.guests}`,
    `already secured: ${counts.alreadySecured}`,
    `ignored (unreferenced): ${counts.ignored}`,
    `indicator preRegistered: ${indicators.preRegistered}`,
    `indicator passwordSession: ${indicators.passwordSession}`,
    `indicator authData: ${indicators.authData}`,
    `members with sessions revoked: ${changes.membersRevoked}`,
    `guests secured: ${changes.guestsSecured}`,
    `failed accounts: ${failed.length}`,
    'note: disabled-only members are treated as guests',
    ...flagged.map(
      entry => `flagged ${entry.class} ${entry.id} ${entry.email} [${entry.indicators.join(',')}]`
    ),
    ...failed.map(entry => `failed ${entry.id} ${entry.email}`),
    '',
  ].join('\n');

export async function runSecureUnverifiedAccounts({
  argv = process.argv.slice(2),
  env = process.env,
  connect = uri => new MongoClient(uri),
  passwords = passwordUtils,
  write = text => process.stdout.write(text),
} = {}) {
  const apply = argv.includes('--apply');
  const configuredUri = env.DATABASE_URI || env.MONGODB_URI;
  if (apply && !configuredUri) {
    throw new Error('--apply requires DATABASE_URI or MONGODB_URI to be set explicitly');
  }
  const client = connect(configuredUri || DEFAULT_DATABASE_URI);
  await client.connect();
  try {
    const summary = await secureUnverifiedAccounts({
      database: client.db(),
      apply,
      limit: parseLimit(argv),
      hashPassword: passwords.hash,
      generatePassword: generateGuestPassword,
      now: () => new Date(),
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
  process.exitCode = exitCodeFor(await runSecureUnverifiedAccounts());
}
