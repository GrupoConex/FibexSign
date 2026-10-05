import axios from 'axios';
import PDF from '../../cloud/parsefunction/pdf/PDF.js';
import { resetCommsMailBreaker } from '../../cloud/parsefunction/shared/commsMailClient.js';

const ENV_KEYS = ['COMMS_BASE_URL', 'COMMS_API_KEY', 'PUBLIC_URL', 'PFX_BASE64'];
const HEADERS = { 'x-real-ip': '10.0.0.1', public_url: 'https://app.test' };

const saveObject = async (className, values) => {
  const object = new Parse.Object(className);
  await object.save(values, { useMasterKey: true });
  return object;
};

const pointer = object => object.toPointer();

const createContact = (name, email) =>
  saveObject('contracts_Contactbook', { Name: name, Email: email });

const buildPlaceholder = (contact, extra = {}) => ({
  Role: `Signer ${contact.get('Name')}`,
  signerObjId: contact.id,
  signerPtr: { __type: 'Pointer', className: 'contracts_Contactbook', objectId: contact.id },
  email: contact.get('Email'),
  ...extra,
});

const createSequentialDocument = async (overrides = {}, ownerExtras = {}) => {
  const owner = await saveObject('contracts_Users', {
    Name: 'Owner',
    Email: 'owner@x.com',
    Company: 'Acme',
    ...ownerExtras,
  });
  const first = await createContact('First', 'first@x.com');
  const viewer = await createContact('Viewer', 'viewer@x.com');
  const second = await createContact('Second', 'second@x.com');
  const document = await saveObject('contracts_Document', {
    Name: 'Contract',
    SendinOrder: true,
    IsEnableOTP: false,
    ExtUserPtr: pointer(owner),
    Signers: [first, viewer, second].map(pointer),
    Placeholders: [
      { Role: 'prefill', email: '' },
      buildPlaceholder(first),
      buildPlaceholder(viewer, { SignerRole: 'viewer' }),
      buildPlaceholder(second),
    ],
    ...overrides,
  });
  return { document, first, second };
};

describe('signPdf next signer notification', () => {
  let saved;
  let fetchSpy;

  const signRequest = (document, contact, params = {}) => ({
    params: {
      docId: document.id,
      userId: contact.id,
      pdfFile: Buffer.from('%PDF-1.4 test').toString('base64'),
      ...params,
    },
    headers: HEADERS,
  });

  const sentBodies = () => fetchSpy.calls.allArgs().map(args => JSON.parse(args[1].body));

  beforeEach(() => {
    resetCommsMailBreaker();
    saved = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
    process.env.COMMS_BASE_URL = 'https://comms.test';
    process.env.COMMS_API_KEY = 'test-key';
    process.env.PFX_BASE64 = Buffer.from('pfx').toString('base64');
    delete process.env.PUBLIC_URL;
    spyOn(console, 'log');
    fetchSpy = spyOn(globalThis, 'fetch').and.resolveTo({ status: 201 });
    spyOn(axios, 'post').and.resolveTo({ data: { url: 'https://files.test/signed.pdf' } });
    spyOn(axios, 'put').and.resolveTo({ data: {} });
  });

  afterEach(() => {
    ENV_KEYS.forEach(key => {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    });
  });

  it('emails the next signer without any session for a guest signing without OTP', async () => {
    const { document, first } = await createSequentialDocument();

    const result = await PDF(signRequest(document, first));

    expect(result.status).toBe('success');
    const bodies = sentBodies();
    expect(bodies.length).toBe(1);
    expect(bodies[0].to).toBe('second@x.com');
  });

  it('prefers the document request template over the tenant template', async () => {
    const tenant = await saveObject('partners_Tenant', {
      RequestSubject: 'Tenant subject',
      RequestBody: '<p>Tenant body</p>',
    });
    const { document, first } = await createSequentialDocument(
      { RequestSubject: 'Doc subject {{receiver_name}}', RequestBody: '<p>Doc body</p>' },
      { TenantId: pointer(tenant) }
    );

    await PDF(signRequest(document, first));

    const [body] = sentBodies();
    expect(body.subject).toBe('Doc subject Second');
    expect(body.html).toContain('Doc body');
  });

  it('sends no second email when a signer who already signed replays signPdf', async () => {
    const { document, first } = await createSequentialDocument();
    await document.save(
      { AuditTrail: [{ UserPtr: { objectId: first.id }, Activity: 'Signed' }] },
      { useMasterKey: true }
    );

    const result = await PDF(signRequest(document, first));

    expect(result.status).toBe('success');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends nothing when sendNextMail is false and still signs', async () => {
    const { document, first } = await createSequentialDocument();

    const result = await PDF(signRequest(document, first, { sendNextMail: false }));

    expect(result.status).toBe('success');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends nothing when the document is not sequential', async () => {
    const { document, first } = await createSequentialDocument({ SendinOrder: false });

    await PDF(signRequest(document, first));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends nothing when the signer is the last one', async () => {
    const { document, second } = await createSequentialDocument();

    const result = await PDF(signRequest(document, second));

    expect(result.status).toBe('success');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps the signature successful when the mail transport fails', async () => {
    fetchSpy.and.rejectWith(new Error('network down'));
    const { document, first } = await createSequentialDocument();

    const result = await PDF(signRequest(document, first));

    expect(result).toEqual({ status: 'success', data: 'https://files.test/signed.pdf' });
  });
});
