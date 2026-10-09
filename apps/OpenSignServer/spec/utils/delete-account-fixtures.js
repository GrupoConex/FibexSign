import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import axios from 'axios';
import * as deleteUtils from '../../cloud/customRoute/deleteAccount/deleteUtils.js';
import { resetCommsMailBreaker } from '../../cloud/parsefunction/shared/commsMailClient.js';
import { createCaller, pointer } from './auth-fixtures.js';

const MASTER = { useMasterKey: true };
const ROUTE_ROOT = 'http://localhost:30001';
const COMMS_ORIGIN = 'https://comms.test';
const COMMS_KEYS = ['COMMS_BASE_URL', 'COMMS_API_KEY'];
const OTP_IN_MAIL = /(\d{6})<\/span>/;
const COOLDOWN_ELAPSED_MS = 60 * 1000;

const postJson = (path, body) =>
  axios.post(`${ROUTE_ROOT}${path}`, body, { validateStatus: () => true });

export const requestDeleteOtp = userId => postJson(`/delete-account/${userId}/otp`, {});

export const submitDeletion = (userId, otp) => postJson(`/delete-account/${userId}`, { otp });

export const openDeletePage = userId =>
  axios.get(`${ROUTE_ROOT}/delete-account/${userId}`, { validateStatus: () => true });

export const deleteAsAdmin = (sessionToken, userId) =>
  axios.post(
    `${ROUTE_ROOT}/deleteuser/${userId}`,
    {},
    { headers: { sessiontoken: sessionToken }, validateStatus: () => true }
  );

export const otpFromMail = mail => mail.html.match(OTP_IN_MAIL)[1];

export const useCommsMailCapture = () => {
  const capture = { sent: [], providerStatus: 201, last: () => capture.sent.at(-1) };
  let savedEnv;

  beforeEach(() => {
    capture.sent = [];
    capture.providerStatus = 201;
    resetCommsMailBreaker();
    savedEnv = Object.fromEntries(COMMS_KEYS.map(key => [key, process.env[key]]));
    process.env.COMMS_BASE_URL = COMMS_ORIGIN;
    process.env.COMMS_API_KEY = 'test-key';
    const originalFetch = globalThis.fetch;
    spyOn(globalThis, 'fetch').and.callFake(async (url, init) => {
      if (!String(url).startsWith(COMMS_ORIGIN)) {
        return originalFetch(url, init);
      }
      capture.sent.push(JSON.parse(init.body));
      return { status: capture.providerStatus, json: async () => ({ status: 'SENT' }) };
    });
  });

  afterEach(() => {
    COMMS_KEYS.forEach(key => {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    });
  });

  return capture;
};

export const createDeletableAdmin = () => createCaller('contracts_Admin');

export const findDeleteOtpRow = email => {
  const query = new Parse.Query('defaultdata_Otp');
  query.equalTo('Email', deleteUtils.deleteOtpKey(email));
  return query.first(MASTER);
};

export const updateDeleteOtpRow = async (email, values) => {
  const row = await findDeleteOtpRow(email);
  await row.save(values, MASTER);
  return row;
};

export const elapseCooldown = async extUser => {
  await extUser.save({ DeleteOTPSentAt: new Date(Date.now() - COOLDOWN_ELAPSED_MS) }, MASTER);
};

export const reloadExtUser = extUser => new Parse.Query('contracts_Users').get(extUser.id, MASTER);

export const accountExists = async userId =>
  Boolean(await new Parse.Query(Parse.User).equalTo('objectId', userId).first(MASTER));

export const requestOtpAndReadCode = async (admin, capture) => {
  const response = await requestDeleteOtp(admin.account.id);
  return { response, code: capture.last() ? otpFromMail(capture.last()) : undefined };
};

export const userPointer = userId => pointer('_User', userId);

const LOCAL_FILES_DIR = './files/files';
const LOCAL_FILE_HOST = 'http://localhost:30001';

export const existsRecord = async (className, objectId) =>
  Boolean(await new Parse.Query(className).equalTo('objectId', objectId).first(MASTER));

export const countWhere = (className, field, pointerValue) =>
  new Parse.Query(className).equalTo(field, pointerValue).count(MASTER);

export const saveRows = (className, rows) =>
  Parse.Object.saveAll(
    rows.map(values => new Parse.Object(className, values)),
    MASTER
  );

export const localFileUrl = fileName =>
  `${LOCAL_FILE_HOST}/files/${process.env.APP_ID}/${fileName}`;

export const createLocalFile = async fileName => {
  await mkdir(LOCAL_FILES_DIR, { recursive: true });
  await writeFile(`${LOCAL_FILES_DIR}/${fileName}`, 'content');
  return `${LOCAL_FILES_DIR}/${fileName}`;
};

export const localFileExists = async path => {
  return access(path).then(
    () => true,
    () => false
  );
};

export const removeLocalFile = async path => {
  await rm(path, { recursive: true, force: true });
};

export const uniqueFileName = prefix =>
  `${prefix}-${Date.now()}-${Math.round(performance.now() * 1000)}.pdf`;

export const seedOwnedRecords = async (admin, { signatures = 1, documentUrl } = {}) => {
  const userPtr = pointer('_User', admin.account.id);
  const tenantPtr = pointer('partners_Tenant', admin.tenant.id);
  await saveRows('contracts_Document', [{ Name: 'Doc', CreatedBy: userPtr, URL: documentUrl }]);
  await saveRows('contracts_Template', [{ Name: 'Template', CreatedBy: userPtr }]);
  await saveRows('contracts_Contactbook', [{ Name: 'Contact', CreatedBy: userPtr }]);
  await saveRows('appToken', [{ UserId: userPtr }]);
  await saveRows('partners_DataFiles', [{ UserId: userPtr, TenantPtr: tenantPtr }]);
  await saveRows('partners_TenantCredits', [{ PartnersTenant: tenantPtr, usedStorage: 10 }]);
  await saveRows(
    'contracts_Signature',
    Array.from({ length: signatures }, () => ({ UserId: userPtr }))
  );
  return { userPtr, tenantPtr };
};

export const countOwnedRecords = async admin => {
  const userPtr = pointer('_User', admin.account.id);
  const tenantPtr = pointer('partners_Tenant', admin.tenant.id);
  return {
    documents: await countWhere('contracts_Document', 'CreatedBy', userPtr),
    templates: await countWhere('contracts_Template', 'CreatedBy', userPtr),
    contacts: await countWhere('contracts_Contactbook', 'CreatedBy', userPtr),
    appTokens: await countWhere('appToken', 'UserId', userPtr),
    dataFiles: await countWhere('partners_DataFiles', 'UserId', userPtr),
    credits: await countWhere('partners_TenantCredits', 'PartnersTenant', tenantPtr),
    signatures: await countWhere('contracts_Signature', 'UserId', userPtr),
    sessions: await countWhere('_Session', 'user', userPtr),
    extUsers: await countWhere('contracts_Users', 'UserId', userPtr),
  };
};

const buildInvalidSessionError = () =>
  Object.assign(new Error('Request failed with status code 400'), {
    response: { data: { code: 209, error: 'Invalid session token' } },
  });

export const stubSessionLookup = () => {
  const originalGet = axios.get.bind(axios);
  return spyOn(axios, 'get').and.callFake(async (url, config) => {
    if (!String(url).endsWith('/users/me')) return originalGet(url, config);
    const session = await new Parse.Query('_Session')
      .equalTo('sessionToken', config.headers['X-Parse-Session-Token'])
      .include('user')
      .first(MASTER);
    if (!session) throw buildInvalidSessionError();
    return { data: { objectId: session.get('user').id } };
  });
};
