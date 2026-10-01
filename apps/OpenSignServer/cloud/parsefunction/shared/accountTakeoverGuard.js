import { generateGuestPassword } from './guestPassword.js';

const MASTER = { useMasterKey: true };
const EMAIL_NOT_VERIFIED_MESSAGE = 'Email not verified.';
const SERVER_AUTH_PROVIDER = 'masterkey';
const SESSION_CLASS = '_Session';
const SESSION_BATCH_SIZE = 1000;
const SESSION_PROVIDER_FIELD = 'createdWith.authProvider';

const toUserPointer = userId => ({ __type: 'Pointer', className: '_User', objectId: userId });

const toTenantPointer = tenantId => ({
  __type: 'Pointer',
  className: 'partners_Tenant',
  objectId: tenantId,
});

const normalizeEmail = email => email?.toLowerCase()?.replace(/\s/g, '');

export async function createAccountAsServer({ name, email, password, phone, emailVerified }) {
  const normalizedEmail = normalizeEmail(email);
  const account = new Parse.User();
  account.set('username', normalizedEmail);
  account.set('email', normalizedEmail);
  account.set('normalizedEmail', normalizedEmail);
  account.set('password', password);
  account.set('name', name);
  if (phone) {
    account.set('phone', phone);
  }
  if (emailVerified === true) {
    account.set('emailVerified', true);
  }
  return account.save(null, MASTER);
}

const buildSessionQuery = (userId, { keptSessionToken, onlyUntrusted }) => {
  const query = new Parse.Query(SESSION_CLASS);
  query.equalTo('user', toUserPointer(userId));
  if (onlyUntrusted) {
    query.notEqualTo(SESSION_PROVIDER_FIELD, SERVER_AUTH_PROVIDER);
  }
  if (keptSessionToken) {
    query.notEqualTo('sessionToken', keptSessionToken);
  }
  return query.limit(SESSION_BATCH_SIZE);
};

async function destroyMatchingSessions(query) {
  let sessions = await query.find(MASTER);
  while (sessions.length > 0) {
    await Parse.Object.destroyAll(sessions, MASTER);
    sessions = await query.find(MASTER);
  }
}

export const revokeUntrustedSessions = (userId, keptSessionToken) =>
  destroyMatchingSessions(buildSessionQuery(userId, { keptSessionToken, onlyUntrusted: true }));

const revokeAllSessions = userId => destroyMatchingSessions(buildSessionQuery(userId, {}));

const revokeAllSessionsWithFinalPass = async userId => {
  await revokeAllSessions(userId);
  await revokeAllSessions(userId);
};

const buildActiveMembershipQuery = userId => {
  const query = new Parse.Query('contracts_Users');
  query.equalTo('UserId', toUserPointer(userId));
  query.notEqualTo('IsDisabled', true);
  return query;
};

export async function findTenantIdOfUser(userId) {
  const membership = await buildActiveMembershipQuery(userId).first(MASTER);
  return membership?.get('TenantId')?.id;
}

export const isTenantOwner = async userId => {
  const query = new Parse.Query('partners_Tenant');
  query.equalTo('UserId', toUserPointer(userId));
  return Boolean(await query.first(MASTER));
};

const isActiveMemberOfTenant = async (userId, tenantId) => {
  if (!tenantId) {
    return false;
  }
  const query = buildActiveMembershipQuery(userId);
  query.equalTo('TenantId', toTenantPointer(tenantId));
  return Boolean(await query.first(MASTER));
};

const isAccountClaimed = async (user, linkingTenantId) =>
  user.get('emailVerified') === true ||
  (await isTenantOwner(user.id)) ||
  (await isActiveMemberOfTenant(user.id, linkingTenantId));

export const unlinkAuthProviders = user => {
  const providers = Object.keys(user.get('authData') || {});
  if (providers.length > 0) {
    user.set('authData', Object.fromEntries(providers.map(provider => [provider, null])));
  }
};

const replaceCredentials = async user => {
  user.set('password', generateGuestPassword());
  unlinkAuthProviders(user);
  await user.save(null, MASTER);
};

export async function secureUnverifiedAccount(userId, { linkingTenantId } = {}) {
  const user = await new Parse.Query(Parse.User).get(userId, MASTER);
  if (await isAccountClaimed(user, linkingTenantId)) {
    return { secured: false };
  }
  await replaceCredentials(user);
  await revokeAllSessionsWithFinalPass(userId);
  return { secured: true };
}

export async function assertEmailVerifiedOrTenantOwner(request) {
  const user = request.object;
  if (user.get('emailVerified') === true || (await isTenantOwner(user.id))) {
    return;
  }
  throw new Parse.Error(Parse.Error.EMAIL_NOT_FOUND, EMAIL_NOT_VERIFIED_MESSAGE);
}
