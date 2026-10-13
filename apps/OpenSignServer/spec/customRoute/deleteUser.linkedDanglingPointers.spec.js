import axios from 'axios';
import { sendCompletedMail } from '../../cloud/parsefunction/pdf/PDF.js';
import { resetCommsMailBreaker } from '../../cloud/parsefunction/shared/commsMailClient.js';
import { buildSignerInvitationMail } from '../../cloud/parsefunction/shared/signerInvitationMail.js';
import {
  authorizeSendMailv3,
  loadMailContext,
  resetSendMailv3UserLimits,
} from '../../cloud/parsefunction/shared/sendMailv3Authorization.js';
import {
  linkGuestInto,
  openGuestSession,
  stubSessionLookup,
} from '../utils/delete-account-fixtures.js';
import {
  createCaller,
  createPlainUser,
  createTenantMember,
  pointer,
  resetAuthState,
  silenceConsole,
  uniqueEmail,
  waitUntil,
} from '../utils/auth-fixtures.js';
import { fileUrl, runFunctionOverRest, seedContact, seedRow } from '../utils/document-fixtures.js';

const MASTER = { useMasterKey: true };
const TEMPLATES_REPORT = '6TeaPr321t';
const NEED_YOUR_SIGN_REPORT = '4Hhwbp482K';
const DAY_MS = 24 * 60 * 60 * 1000;
const PUBLIC_URL = 'https://sign.example.com';

const realGet = axios.get.bind(axios);
const COMMS_ENV = { COMMS_BASE_URL: 'https://comms.test', COMMS_API_KEY: 'test-key' };

const withCommsMail = async run => {
  const saved = Object.fromEntries(Object.keys(COMMS_ENV).map(key => [key, process.env[key]]));
  Object.assign(process.env, COMMS_ENV);
  resetCommsMailBreaker();
  try {
    return await run();
  } finally {
    Object.entries(saved).forEach(([key, value]) =>
      value === undefined ? delete process.env[key] : (process.env[key] = value)
    );
  }
};

const lookUpSessionsOnServer = () =>
  axios.get.and.callFake((url, config = {}) =>
    realGet(url, { ...config, headers: { ...config.headers, 'X-Parse-Javascript-Key': 'test' } })
  );

const extUserPointer = id => pointer('contracts_Users', id);

const waitForTeamAncestors = team =>
  waitUntil(async () => {
    const reloaded = await new Parse.Query('contracts_Teams').get(team.id, MASTER);
    return (reloaded.get('Ancestors') ?? []).length > 0;
  });

const seedGuestDocument = (guest, linkedId, contact, member) =>
  seedRow('contracts_Document', {
    Name: 'Guest contract',
    URL: fileUrl('guest.pdf'),
    SignedUrl: fileUrl('guest-signed.pdf'),
    CreatedBy: pointer('_User', guest.id),
    ExtUserPtr: extUserPointer(linkedId),
    Signers: [pointer('contracts_Contactbook', contact.id)],
    Placeholders: [{ signerObjId: contact.id, Role: 'signer', placeHolder: [] }],
    ExpiryDate: new Date(Date.now() + DAY_MS),
    SharedWithUsers: [extUserPointer(member.extUser.id)],
  });

const seedGuestTemplate = (guest, linkedId, admin, member) =>
  seedRow('contracts_Template', {
    Name: 'Guest template',
    URL: fileUrl('guest-template.pdf'),
    CreatedBy: pointer('_User', guest.id),
    ExtUserPtr: extUserPointer(linkedId),
    SharedWith: [pointer('contracts_Teams', admin.team.id)],
    SharedWithUsers: [extUserPointer(linkedId), extUserPointer(member.extUser.id)],
  });

const destroyOwnerProfile = async objectId => {
  const profile = await new Parse.Query('contracts_Users').get(objectId, MASTER);
  await profile.destroy(MASTER);
};

const orphanGuestWork = async () => {
  const admin = await createCaller('contracts_Admin');
  const member = await createTenantMember('contracts_User', admin);
  const guest = await createPlainUser(uniqueEmail('guest-dangling'));
  const linked = await linkGuestInto(admin, guest);
  const contact = await seedContact({ account: guest }, admin.account);
  const document = await seedGuestDocument(guest, linked.objectId, contact, member);
  const template = await seedGuestTemplate(guest, linked.objectId, admin, member);
  const guestSession = await openGuestSession(guest);
  await waitForTeamAncestors(admin.team);
  await destroyOwnerProfile(linked.objectId);
  return { admin, member, guest, guestSession, linkedId: linked.objectId, document, template };
};

const runReport = async (reportId, sessionToken) => {
  const body = await runFunctionOverRest(
    'getReport',
    { reportId, limit: 20, skip: 0 },
    { sessiontoken: sessionToken }
  );
  return body.result;
};

const idsOf = rows => rows.map(row => row.objectId ?? row.id);

const fetchWithOwner = (className, objectId) =>
  new Parse.Query(className)
    .include('ExtUserPtr,Signers,ExtUserPtr.TenantId,Bcc,Cc,CreatedBy')
    .get(objectId, MASTER);

const fetchRaw = (className, objectId) => new Parse.Query(className).get(objectId, MASTER);

describe('tenant read paths when the owner profile of a document no longer exists', () => {
  let scenario;

  beforeEach(async () => {
    silenceConsole();
    spyOn(console, 'error');
    stubSessionLookup();
    resetSendMailv3UserLimits();
    await resetAuthState();
    scenario = await orphanGuestWork();
  });

  afterEach(async () => {
    await resetAuthState();
  });

  it('lists the guest template in the templates report of the admin and the member', async () => {
    lookUpSessionsOnServer();
    const forAdmin = await runReport(TEMPLATES_REPORT, scenario.admin.account.sessionToken);
    const forMember = await runReport(TEMPLATES_REPORT, scenario.member.account.sessionToken);

    expect(idsOf(forAdmin)).toContain(scenario.template.id);
    expect(idsOf(forMember)).toContain(scenario.template.id);
  });

  it('lists the guest document in the need your sign report of its signer', async () => {
    const rows = await runReport(NEED_YOUR_SIGN_REPORT, scenario.admin.account.sessionToken);

    expect(idsOf(rows)).toContain(scenario.document.id);
  });

  it('returns the guest document from getDocument', async () => {
    const body = await runFunctionOverRest('getDocument', { docId: scenario.document.id });

    expect(body.result.objectId).toBe(scenario.document.id);
    expect(body.result.ExtUserPtr).toBeUndefined();
  });

  it('returns the guest template from getTemplate to a member it is shared with', async () => {
    const body = await runFunctionOverRest(
      'getTemplate',
      { templateId: scenario.template.id },
      { sessiontoken: scenario.member.account.sessionToken }
    );

    expect(body.result.objectId).toBe(scenario.template.id);
  });

  it('reads both records through the afterFind handlers with or without the owner included', async () => {
    const document = await fetchWithOwner('contracts_Document', scenario.document.id);
    const template = await fetchWithOwner('contracts_Template', scenario.template.id);
    const rawDocument = await fetchRaw('contracts_Document', scenario.document.id);

    expect(document.id).toBe(scenario.document.id);
    expect(template.id).toBe(scenario.template.id);
    expect(document.get('ExtUserPtr')).toBeUndefined();
    expect(rawDocument.get('ExtUserPtr').id).toBe(scenario.linkedId);
  });

  it('builds the mail context and authorizes the guest and a member shared with', async () => {
    const context = await loadMailContext(scenario.document.id, 'contracts_Document');
    const params = { docId: scenario.document.id, recipient: scenario.admin.account.email };

    const asGuest = await authorizeSendMailv3({ user: { id: scenario.guest.id }, params });
    const asMember = await authorizeSendMailv3({
      user: { id: scenario.member.account.id },
      params,
    });

    expect(context.extUserId).toBeUndefined();
    expect(context.tenantId).toBeUndefined();
    expect(asGuest).toEqual({ extUserId: '' });
    expect(asMember).toEqual({ extUserId: '' });
  });

  it('builds a signer invitation for the guest document', async () => {
    const document = await fetchWithOwner('contracts_Document', scenario.document.id);
    const json = JSON.parse(JSON.stringify(document));

    const mail = buildSignerInvitationMail({
      document: json,
      placeholder: json.Placeholders[0],
      publicUrl: PUBLIC_URL,
    });

    expect(mail.extUserId).toBeUndefined();
    expect(mail.recipient).toBe(scenario.admin.account.email);
  });

  it('sends the completion mail of the guest document to its signers', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').and.resolveTo({ status: 201 });
    const document = await fetchWithOwner('contracts_Document', scenario.document.id);

    await withCommsMail(() => sendCompletedMail({ doc: document.toJSON() }));

    const [request] = fetchSpy.calls.allArgs();
    expect(JSON.parse(request[1].body).to).toBe(scenario.admin.account.email);
  });

  it('keeps listing the guest own work in its drive and document search', async () => {
    const drive = await runFunctionOverRest(
      'getDrive',
      { limit: 20, skip: 0 },
      {
        sessiontoken: scenario.guestSession,
      }
    );
    const search = await Parse.Cloud.run(
      'filterdocs',
      { searchTerm: 'Guest' },
      { sessionToken: scenario.guestSession }
    );

    expect(idsOf(drive.result)).toContain(scenario.document.id);
    expect(idsOf(search)).toContain(scenario.document.id);
  });
});
