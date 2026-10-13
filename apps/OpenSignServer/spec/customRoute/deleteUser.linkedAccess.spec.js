import axios from 'axios';
import { resolveCallerProfile } from '../../cloud/parsefunction/shared/callerProfile.js';
import { loadCallerAccess } from '../../cloud/parsefunction/shared/sendMailv3Authorization.js';
import { buildAccessibleTemplateQuery } from '../../cloud/parsefunction/shared/templateAccess.js';
import {
  deleteAsAdmin,
  linkGuestInto,
  openGuestSession,
  stubSessionLookup,
} from '../utils/delete-account-fixtures.js';
import {
  captureRejection,
  cloudRunAs,
  createCaller,
  createExtUser,
  createPlainUser,
  createTenantMember,
  createTenantScope,
  pointer,
  resetAuthState,
  silenceConsole,
  uniqueEmail,
  waitUntil,
} from '../utils/auth-fixtures.js';
import { TEMPLATE_GONE, runFunctionOverRest, seedRow } from '../utils/document-fixtures.js';

const MASTER = { useMasterKey: true };
const TEMPLATES_REPORT = '6TeaPr321t';
const OPERATION_FORBIDDEN = 119;
const realGet = axios.get.bind(axios);

const lookUpSessionsOnServer = () =>
  axios.get.and.callFake((url, config = {}) =>
    realGet(url, { ...config, headers: { ...config.headers, 'X-Parse-Javascript-Key': 'test' } })
  );

const restPut = (path, sessionToken, data) =>
  axios.put(`${process.env.SERVER_URL}${path}`, data, {
    headers: {
      'X-Parse-Application-Id': process.env.APP_ID,
      'X-Parse-Javascript-Key': 'test',
      'X-Parse-Session-Token': sessionToken,
    },
    validateStatus: () => true,
  });

const waitForTeamAncestors = team =>
  waitUntil(async () => {
    const reloaded = await new Parse.Query('contracts_Teams').get(team.id, MASTER);
    return (reloaded.get('Ancestors') ?? []).length > 0;
  });

const shareTemplateWithGuest = (admin, linkedId) =>
  seedRow('contracts_Template', {
    Name: 'Shared with guest',
    CreatedBy: pointer('_User', admin.account.id),
    SharedWith: [pointer('contracts_Teams', admin.team.id)],
    SharedWithUsers: [pointer('contracts_Users', linkedId)],
  });

const removeLinkedGuest = async () => {
  const admin = await createCaller('contracts_Admin');
  const guest = await createPlainUser(uniqueEmail('guest-access'));
  const linked = await linkGuestInto(admin, guest);
  const template = await shareTemplateWithGuest(admin, linked.objectId);
  const guestSession = await openGuestSession(guest);
  await waitForTeamAncestors(admin.team);
  const removal = await deleteAsAdmin(admin.account.sessionToken, guest.id);
  expect(removal.status).toBe(200);
  return { admin, guest, guestSession, linkedId: linked.objectId, template };
};

const canOpenTemplate = async (userId, templateId) => {
  const access = await loadCallerAccess(userId);
  const query = buildAccessibleTemplateQuery({ userId, access, templateId });
  return Boolean(await query.first(MASTER));
};

const templatesReportOf = async sessionToken => {
  const body = await runFunctionOverRest(
    'getReport',
    { reportId: TEMPLATES_REPORT, limit: 20, skip: 0 },
    { sessiontoken: sessionToken }
  );
  return body.result;
};

const idsOf = rows => rows.map(row => row.objectId);

describe('membership paths after a linked guest is removed from the organization', () => {
  let scenario;

  beforeEach(async () => {
    silenceConsole();
    spyOn(console, 'error');
    stubSessionLookup();
    await resetAuthState();
    scenario = await removeLinkedGuest();
  });

  afterEach(async () => {
    await resetAuthState();
  });

  it('resolves no caller access and no caller profile for the removed row', async () => {
    const failure = await captureRejection(
      resolveCallerProfile(scenario.guest.id, scenario.linkedId)
    );

    expect(await loadCallerAccess(scenario.guest.id)).toBeNull();
    expect(failure.code).toBe(OPERATION_FORBIDDEN);
  });

  it('grants no template access through the removed row', async () => {
    const body = await runFunctionOverRest(
      'getTemplate',
      { templateId: scenario.template.id },
      { sessiontoken: scenario.guestSession }
    );

    expect(await canOpenTemplate(scenario.guest.id, scenario.template.id)).toBeFalse();
    expect(body.result).toEqual({ error: TEMPLATE_GONE });
  });

  it('keeps tenant templates out of the templates report of the removed guest', async () => {
    lookUpSessionsOnServer();

    const rows = await templatesReportOf(scenario.guestSession);

    expect(idsOf(rows)).not.toContain(scenario.template.id);
  });

  it('refuses team listing and user creation to the removed guest', async () => {
    const teams = await captureRejection(
      cloudRunAs('getteams', { active: true }, scenario.guestSession)
    );
    const adding = await captureRejection(
      cloudRunAs(
        'adduser',
        {
          name: 'Intruder',
          email: uniqueEmail('intruder'),
          password: 'Intruder-Passw0rd!',
          organization: { objectId: scenario.admin.organization.id },
          team: scenario.admin.team.id,
          role: 'User',
          tenantId: scenario.admin.tenant.id,
        },
        scenario.guestSession
      )
    );

    expect(teams).not.toBeNull();
    expect(adding?.message).toBe('User not found.');
  });

  it('does not promote the removed row through UpdateExistUserAsAdmin', async () => {
    const failure = await captureRejection(
      Parse.Cloud.run('updateuserasadmin', {
        email: scenario.guest.email,
        masterkey: process.env.MASTER_KEY,
      })
    );
    const row = await new Parse.Query('contracts_Users').get(scenario.linkedId, MASTER);

    expect(failure).not.toBeNull();
    expect(row.get('UserRole')).toBe('contracts_User');
  });

  it('returns no profile for the removed guest from getUserDetails', async () => {
    const own = await cloudRunAs('getUserDetails', {}, scenario.guestSession);
    const byEmail = await cloudRunAs('getUserDetails', { email: scenario.guest.email });

    expect(own).toBe('');
    expect(byEmail).toEqual({ exists: false });
  });

  it('returns the home profile of a removed guest that has one from getUserDetails', async () => {
    const home = await createTenantScope();
    const homeProfile = await createExtUser({
      account: scenario.guest,
      role: 'contracts_Admin',
      tenant: home.tenant,
      organization: home.organization,
      team: home.team,
    });

    const own = await cloudRunAs('getUserDetails', {}, scenario.guestSession);

    expect(own.id).toBe(homeProfile.id);
  });

  it('returns no tenant settings to the removed guest from gettenant', async () => {
    const tenant = await cloudRunAs(
      'gettenant',
      { userId: scenario.guest.id },
      scenario.guestSession
    );

    expect(tenant?.id).not.toBe(scenario.admin.tenant.id);
  });

  it('hides the removed row from the organization user list but keeps deactivated members', async () => {
    const deactivated = await createTenantMember('contracts_User', {
      ...scenario.admin,
      extras: { IsDisabled: true },
    });

    const rows = await cloudRunAs(
      'getuserlistbyorg',
      { organizationId: scenario.admin.organization.id },
      scenario.admin.account.sessionToken
    );

    expect(idsOf(rows)).not.toContain(scenario.linkedId);
    expect(idsOf(rows)).toContain(deactivated.extUser.id);
  });

  it('does not let the toggle reactivate or unmark the removed row', async () => {
    const path = `/classes/contracts_Users/${scenario.linkedId}`;
    const token = scenario.admin.account.sessionToken;

    const toggled = await restPut(path, token, { IsDisabled: false });
    const unmarked = await restPut(path, token, { RemovedFromOrgAt: { __op: 'Delete' } });
    const row = await new Parse.Query('contracts_Users').get(scenario.linkedId, MASTER);

    expect(toggled.status).toBeGreaterThanOrEqual(400);
    expect(unmarked.status).toBeGreaterThanOrEqual(400);
    expect(row.get('IsDisabled')).toBeTrue();
    expect(row.get('RemovedFromOrgAt')).toEqual(jasmine.any(Date));
  });
});
