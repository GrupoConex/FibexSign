import fs from 'node:fs';
import { Readable } from 'node:stream';
import axios from 'axios';
import { google } from 'googleapis';
import PDF, { runCertificateMail } from '../../cloud/parsefunction/pdf/PDF.js';
import sendMailGmailProvider from '../../cloud/parsefunction/sendMailGmailProvider.js';
import { resetCommsMailBreaker } from '../../cloud/parsefunction/shared/commsMailClient.js';
import { captureConsoleError, uniqueEmail } from '../utils/auth-fixtures.js';

const ENV_KEYS = ['COMMS_BASE_URL', 'COMMS_API_KEY', 'PFX_BASE64'];
const HEADERS = { 'x-real-ip': '10.0.0.1', public_url: 'https://app.test' };
const EXPORTS_DIR = './exports';
const PRIVATE_FILE_MODE = 0o600;

const saveObject = async (className, values) => {
  const object = new Parse.Object(className);
  await object.save(values, { useMasterKey: true });
  return object;
};

const listFiles = (directory, pattern) =>
  fs.existsSync(directory) ? fs.readdirSync(directory).filter(name => pattern.test(name)) : [];

const listKeystores = () => listFiles('.', /^keystore_(?!spec_).*\.pfx$/);
const listSignedExports = () => listFiles(EXPORTS_DIR, /^signed_/);
const listGmailTempPdfs = () => listFiles('.', /^test_.*\.pdf$/);

const createTwoSignerDocument = async () => {
  const owner = await saveObject('contracts_Users', { Name: 'Owner', Email: uniqueEmail('o') });
  const [first, second] = await Promise.all(
    ['First', 'Second'].map(name =>
      saveObject('contracts_Contactbook', { Name: name, Email: uniqueEmail(name) })
    )
  );
  const placeholder = contact => ({
    Role: contact.get('Name'),
    signerObjId: contact.id,
    signerPtr: contact.toPointer(),
    email: contact.get('Email'),
  });
  const document = await saveObject('contracts_Document', {
    Name: 'Contract',
    IsEnableOTP: false,
    ExtUserPtr: owner.toPointer(),
    Signers: [first.toPointer(), second.toPointer()],
    Placeholders: [placeholder(first), placeholder(second)],
  });
  return { document, first };
};

const signRequest = (document, contact) => ({
  params: {
    docId: document.id,
    userId: contact.id,
    pdfFile: Buffer.from('%PDF-1.4 test').toString('base64'),
  },
  headers: HEADERS,
});

describe('signed pdf temporary files', () => {
  let savedEnv;

  beforeEach(() => {
    resetCommsMailBreaker();
    savedEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
    process.env.COMMS_BASE_URL = 'https://comms.test';
    process.env.COMMS_API_KEY = 'test-key';
    process.env.PFX_BASE64 = Buffer.from('pfx').toString('base64');
    spyOn(console, 'log');
    captureConsoleError();
    spyOn(globalThis, 'fetch').and.resolveTo({ status: 201 });
    spyOn(axios, 'post').and.resolveTo({ data: { url: 'https://files.test/signed.pdf' } });
    spyOn(axios, 'put').and.resolveTo({ data: {} });
  });

  afterEach(() => {
    ENV_KEYS.forEach(key => {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    });
  });

  it('writes the signing keystore readable by the server user only', async () => {
    const write = spyOn(fs, 'writeFileSync').and.callThrough();
    const { document, first } = await createTwoSignerDocument();

    await PDF(signRequest(document, first));

    const keystoreWrite = write.calls.allArgs().find(([path]) => /^keystore_/.test(path));
    expect(keystoreWrite[2]).toEqual({ mode: PRIVATE_FILE_MODE });
  });

  it('leaves no keystore or exported pdf after a successful signature', async () => {
    const { document, first } = await createTwoSignerDocument();

    await PDF(signRequest(document, first));

    expect(listKeystores()).toEqual([]);
    expect(listSignedExports()).toEqual([]);
  });

  it('leaves no keystore or exported pdf when the upload fails', async () => {
    axios.post.and.rejectWith(new Error('storage offline'));
    const { document, first } = await createTwoSignerDocument();

    await PDF(signRequest(document, first)).catch(() => undefined);

    expect(listKeystores()).toEqual([]);
    expect(listSignedExports()).toEqual([]);
  });

  it('leaves no keystore or exported pdf when updating the document fails', async () => {
    axios.put.and.rejectWith(new Error('database offline'));
    const { document, first } = await createTwoSignerDocument();

    await PDF(signRequest(document, first)).catch(() => undefined);

    expect(listKeystores()).toEqual([]);
    expect(listSignedExports()).toEqual([]);
  });
});

describe('certificate mail dispatch', () => {
  let keystorePath;

  beforeEach(() => {
    keystorePath = `./keystore_spec_${Date.now()}.pfx`;
    fs.writeFileSync(keystorePath, 'pfx', { mode: PRIVATE_FILE_MODE });
  });

  afterEach(() => fs.rmSync(keystorePath, { force: true }));

  it('removes the keystore once the mail was sent', async () => {
    await runCertificateMail({
      send: async () => 'url',
      pfxPath: keystorePath,
      documentId: 'doc1',
    });

    expect(fs.existsSync(keystorePath)).toBeFalse();
  });

  it('logs the failure with the document id and still removes the keystore', async () => {
    const consoleError = captureConsoleError();
    const failure = new Error('smtp down');

    await runCertificateMail({
      send: () => Promise.reject(failure),
      pfxPath: keystorePath,
      documentId: 'doc42',
    });

    expect(consoleError).toHaveBeenCalledWith(
      'Certificate mail failed for document doc42',
      failure
    );
    expect(fs.existsSync(keystorePath)).toBeFalse();
  });

  it('removes the keystore when sending throws synchronously', async () => {
    captureConsoleError();

    await runCertificateMail({
      send: () => {
        throw new Error('sync failure');
      },
      pfxPath: keystorePath,
      documentId: 'doc7',
    });

    expect(fs.existsSync(keystorePath)).toBeFalse();
  });
});

describe('gmail provider temporary attachment', () => {
  const extRes = { Email: 'sender@x.com', TenantId: { google_refresh_token: 'refresh' } };
  const template = {
    receiver: 'to@x.com',
    subject: 'Subject',
    html: '<p>hi</p>',
    url: 'http://localhost/files/doc.pdf',
    pdfName: 'doc',
  };
  let send;

  beforeEach(() => {
    spyOn(console, 'log');
    spyOn(console, 'error');
    spyOn(axios, 'post').and.resolveTo({ data: { access_token: 'token' } });
    spyOn(axios, 'get').and.callFake(async (url, config) =>
      config?.responseType === 'stream'
        ? { data: Readable.from([Buffer.from('%PDF-1.4')]) }
        : { data: { email: 'g@x.com' } }
    );
    send = jasmine.createSpy('send').and.resolveTo({ status: 200 });
    spyOn(google, 'gmail').and.returnValue({ users: { messages: { send } } });
  });

  afterEach(() => listGmailTempPdfs().forEach(name => fs.rmSync(name, { force: true })));

  it('removes the attachment copy after a successful send', async () => {
    const result = await sendMailGmailProvider(extRes, template);

    expect(result.code).toBe(200);
    expect(listGmailTempPdfs()).toEqual([]);
  });

  it('removes the attachment copy when the send fails', async () => {
    send.and.rejectWith(new Error('quota exceeded'));

    const result = await sendMailGmailProvider(extRes, template);

    expect(result.code).toBe(500);
    expect(listGmailTempPdfs()).toEqual([]);
  });
});
