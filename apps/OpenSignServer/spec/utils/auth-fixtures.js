import axios from 'axios';
import { hashOtp } from '../../cloud/parsefunction/shared/otpPolicy.js';
import { resetAuthRateLimiterStoreForTesting } from '../../utils/authRateLimiter.js';

Parse.User.enableUnsafeCurrentUser();

export const PASSWORD = 'Str0ngPassw0rd!';
export const TEST_OTP = '424242';

const MASTER = { useMasterKey: true };
const REST_HEADERS = {
  'X-Parse-Application-Id': process.env.APP_ID,
  'X-Parse-Master-Key': process.env.MASTER_KEY,
};
let sequence = 0;

export const uniqueEmail = prefix => `${prefix}-${Date.now()}-${sequence++}@example.com`;

export const pointer = (className, objectId) => ({ __type: 'Pointer', className, objectId });

export const resetRateLimits = () => resetAuthRateLimiterStoreForTesting();

export const resetAuthState = async () => {
  await Parse.User.logOut();
  await resetAuthRateLimiterStoreForTesting();
};

export const silenceConsole = () => spyOn(console, 'log');

export const captureConsoleError = () => spyOn(console, 'error');

export const buildUserDetails = (overrides = {}) => ({
  email: uniqueEmail('user'),
  password: PASSWORD,
  name: 'Test User',
  company: 'Acme',
  jobTitle: 'Engineer',
  role: 'contracts_Admin',
  timezone: 'UTC',
  ...overrides,
});

export const findUserByUsername = username => {
  const query = new Parse.Query(Parse.User);
  query.equalTo('username', username);
  return query.first(MASTER);
};

export const findFirstByUserId = (className, userId) => {
  const query = new Parse.Query(className);
  query.equalTo('UserId', pointer('_User', userId));
  return query.first(MASTER);
};

export async function createPlainUser(email = uniqueEmail('plain'), password = PASSWORD) {
  const response = await axios.post(
    `${process.env.SERVER_URL}/users`,
    { username: email, email, password },
    { headers: REST_HEADERS }
  );
  return { id: response.data.objectId, email, sessionToken: response.data.sessionToken };
}

export async function createTenant(name = 'Tenant') {
  const tenant = new Parse.Object('partners_Tenant');
  tenant.set('TenantName', name);
  tenant.set('IsActive', true);
  return tenant.save(null, MASTER);
}

export async function createOrganization(tenant, name = 'Org') {
  const organization = new Parse.Object('contracts_Organizations');
  organization.set('Name', name);
  organization.set('IsActive', true);
  organization.set('TenantId', pointer('partners_Tenant', tenant.id));
  return organization.save(null, MASTER);
}

export async function createTeam(organization, name = 'Team') {
  const team = new Parse.Object('contracts_Teams');
  team.set('Name', name);
  team.set('IsActive', true);
  team.set('OrganizationId', pointer('contracts_Organizations', organization.id));
  return team.save(null, MASTER);
}

export async function createExtUser({ account, role, tenant, organization, team, extras = {} }) {
  const extUser = new Parse.Object('contracts_Users');
  extUser.set('UserId', pointer('_User', account.id));
  extUser.set('Email', account.email);
  extUser.set('Name', 'Fixture User');
  extUser.set('UserRole', role);
  if (tenant) {
    extUser.set('TenantId', pointer('partners_Tenant', tenant.id));
  }
  if (organization) {
    extUser.set('OrganizationId', pointer('contracts_Organizations', organization.id));
  }
  if (team) {
    extUser.set('TeamIds', [pointer('contracts_Teams', team.id)]);
  }
  Object.entries(extras).forEach(([key, value]) => extUser.set(key, value));
  return extUser.save(null, MASTER);
}

export async function createTenantScope() {
  const tenant = await createTenant();
  const organization = await createOrganization(tenant);
  const team = await createTeam(organization);
  return { tenant, organization, team };
}

export async function createTenantMember(role, scope, emailPrefix = 'member') {
  const account = await createPlainUser(uniqueEmail(emailPrefix));
  const { tenant, organization, team, extras } = scope;
  const extUser = await createExtUser({ account, role, tenant, organization, team, extras });
  return { account, extUser };
}

export const cloudRunAs = (name, params, sessionToken) =>
  Parse.Cloud.run(name, params, sessionToken ? { sessionToken } : undefined);

export const captureRejection = async promise => {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
};

export const findOtpRecord = email => {
  const query = new Parse.Query('defaultdata_Otp');
  query.equalTo('Email', email);
  return query.first(MASTER);
};

export async function createOtpRecord(email, fields = {}) {
  const { otp = TEST_OTP, ...storedFields } = fields;
  const record = new Parse.Object('defaultdata_Otp');
  record.set('Email', email);
  record.set('OtpHash', hashOtp(otp));
  record.set('ExpiresAt', new Date(Date.now() + 60 * 1000));
  record.set('FailedAttempts', 0);
  Object.entries(storedFields).forEach(([key, value]) => record.set(key, value));
  return record.save(null, MASTER);
}

export async function purgeAllExtUsers() {
  let batch = await new Parse.Query('contracts_Users').limit(1000).find(MASTER);
  while (batch.length > 0) {
    await Parse.Object.destroyAll(batch, MASTER);
    batch = await new Parse.Query('contracts_Users').limit(1000).find(MASTER);
  }
}

export const rejectSaveFor = (className, error = new Error('save failed')) => {
  const originalSave = Parse.Object.prototype.save;
  return spyOn(Parse.Object.prototype, 'save').and.callFake(function (...args) {
    return this.className === className ? Promise.reject(error) : originalSave.apply(this, args);
  });
};

export const resolveSaveFor = (className, value) => {
  const originalSave = Parse.Object.prototype.save;
  return spyOn(Parse.Object.prototype, 'save').and.callFake(function (...args) {
    return this.className === className ? Promise.resolve(value) : originalSave.apply(this, args);
  });
};

export const interceptQuery = (method, className, respond) => {
  const original = Parse.Query.prototype[method];
  let hits = 0;
  const spy = spyOn(Parse.Query.prototype, method).and.callFake(function (...args) {
    if (this.className !== className) {
      return original.apply(this, args);
    }
    hits += 1;
    return respond(() => original.apply(this, args));
  });
  return { spy, hits: () => hits };
};

export const stubFirstFor = (className, result) =>
  interceptQuery('first', className, async () => result);

const failureOrDefault = failures =>
  failures.length > 0 ? failures[0] : new Error('query failed');

export const rejectFirstFor = (className, ...failures) =>
  interceptQuery('first', className, () => Promise.reject(failureOrDefault(failures)));

export const rejectFindFor = (className, ...failures) =>
  interceptQuery('find', className, () => Promise.reject(failureOrDefault(failures)));

export const stubGetFor = (className, result) =>
  interceptQuery('get', className, async () => result);

export async function createCaller(role, scopeOverrides = {}, extras = {}) {
  const scope = await createTenantScope();
  const member = await createTenantMember(role, { ...scope, ...scopeOverrides, extras }, 'caller');
  return { ...scope, ...member };
}

export async function waitUntil(condition, { timeoutMs = 4000, intervalMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return false;
}
