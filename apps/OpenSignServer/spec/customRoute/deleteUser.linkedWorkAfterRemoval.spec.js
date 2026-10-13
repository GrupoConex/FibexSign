import axios from 'axios';
import { PDFDocument } from 'pdf-lib';
import PDF, { sendCompletedMail } from '../../cloud/parsefunction/pdf/PDF.js';
import { resetCommsMailBreaker } from '../../cloud/parsefunction/shared/commsMailClient.js';
import {
  authorizeSendMailv3,
  resetSendMailv3UserLimits,
} from '../../cloud/parsefunction/shared/sendMailv3Authorization.js';
import {
  deleteAsAdmin,
  linkGuestInto,
  stubSessionLookup,
} from '../utils/delete-account-fixtures.js';
import {
  createCaller,
  createPlainUser,
  pointer,
  resetAuthState,
  silenceConsole,
  uniqueEmail,
} from '../utils/auth-fixtures.js';
import { fileUrl, seedContact, seedRow } from '../utils/document-fixtures.js';

const MASTER = { useMasterKey: true };
const DAY_MS = 24 * 60 * 60 * 1000;
const ENV = {
  COMMS_BASE_URL: 'https://comms.test',
  COMMS_API_KEY: 'test-key',
  PFX_BASE64: Buffer.from('pfx').toString('base64'),
};

const seedGuestDocument = (guest, linkedId, contact) =>
  seedRow('contracts_Document', {
    Name: 'Guest contract',
    URL: fileUrl('guest.pdf'),
    SignedUrl: fileUrl('guest-signed.pdf'),
    CreatedBy: pointer('_User', guest.id),
    ExtUserPtr: pointer('contracts_Users', linkedId),
    Signers: [pointer('contracts_Contactbook', contact.id)],
    Placeholders: [
      { signerObjId: contact.id, Role: 'signer', placeHolder: [] },
      { email: 'pending-signer@example.com', Role: 'signer', placeHolder: [] },
    ],
    ExpiryDate: new Date(Date.now() + DAY_MS),
    IsEnableOTP: false,
  });

const removeGuestKeepingWork = async () => {
  const admin = await createCaller('contracts_Admin');
  const guest = await createPlainUser(uniqueEmail('guest-work'));
  const linked = await linkGuestInto(admin, guest);
  const contact = await seedContact({ account: guest }, admin.account);
  const document = await seedGuestDocument(guest, linked.objectId, contact);
  const removal = await deleteAsAdmin(admin.account.sessionToken, guest.id);
  expect(removal.status).toBe(200);
  return { admin, guest, linkedId: linked.objectId, document };
};

const fetchWithOwner = objectId =>
  new Parse.Query('contracts_Document')
    .include('ExtUserPtr,Signers,ExtUserPtr.TenantId,Bcc,Cc,CreatedBy')
    .get(objectId, MASTER);

const blankPdfBase64 = async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  return Buffer.from(await pdf.save()).toString('base64');
};

const ownerSignRequest = async document => ({
  params: { docId: document.id, pdfFile: await blankPdfBase64() },
  headers: { 'x-real-ip': '10.0.0.1', public_url: 'https://app.test' },
});

describe('guest work after the guest is removed from the organization', () => {
  let scenario;
  let saved;
  let fetchSpy;

  beforeEach(async () => {
    silenceConsole();
    spyOn(console, 'error');
    stubSessionLookup();
    resetSendMailv3UserLimits();
    await resetAuthState();
    scenario = await removeGuestKeepingWork();
    saved = Object.fromEntries(Object.keys(ENV).map(key => [key, process.env[key]]));
    Object.assign(process.env, ENV);
    resetCommsMailBreaker();
    fetchSpy = spyOn(globalThis, 'fetch').and.resolveTo({ status: 201 });
  });

  afterEach(async () => {
    Object.entries(saved).forEach(([key, value]) =>
      value === undefined ? delete process.env[key] : (process.env[key] = value)
    );
    await resetAuthState();
  });

  it('keeps a resolvable owner profile with its tenant on the guest document', async () => {
    const document = await fetchWithOwner(scenario.document.id);

    expect(document.get('ExtUserPtr').id).toBe(scenario.linkedId);
    expect(document.get('ExtUserPtr').get('TenantId').id).toBe(scenario.admin.tenant.id);
    expect(document.get('ExtUserPtr').get('Email')).toBe(scenario.guest.email);
  });

  it('still lets the guest sign its own document as owner', async () => {
    spyOn(axios, 'post').and.resolveTo({ data: { url: 'https://files.test/signed.pdf' } });
    spyOn(axios, 'put').and.resolveTo({ data: {} });

    const result = await PDF(await ownerSignRequest(scenario.document));

    expect(result.status).toBe('success');
  });

  it('still copies the owner on the completion mail', async () => {
    const document = await fetchWithOwner(scenario.document.id);

    await sendCompletedMail({ doc: document.toJSON() });

    const recipients = fetchSpy.calls.allArgs().flatMap(args => JSON.parse(args[1].body).to);
    expect(recipients).toContain(scenario.guest.email);
    expect(recipients).toContain(scenario.admin.account.email);
  });

  it('still lets the tenant admin mail the signers of the guest document', async () => {
    const params = { docId: scenario.document.id, recipient: scenario.admin.account.email };

    const outcome = await authorizeSendMailv3({ user: { id: scenario.admin.account.id }, params });

    expect(outcome.extUserId).toBe(scenario.linkedId);
  });
});
