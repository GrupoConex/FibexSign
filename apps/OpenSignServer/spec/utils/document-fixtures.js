import axios from 'axios';
import { pointer, waitUntil } from './auth-fixtures.js';

const MASTER = { useMasterKey: true };
const JAVASCRIPT_KEY = 'test';
const FILE_HOST = 'https://files.test';

export const NO_DOCUMENT_ACCESS = "You don't have access of this document!";
export const DOCUMENT_GONE = "document deleted or you don't have access.";
export const TEMPLATE_GONE = "template deleted or you don't have access.";

export const fileUrl = name => `${FILE_HOST}/${name}`;

const restHeaders = (extra = {}) => ({
  'X-Parse-Application-Id': process.env.APP_ID,
  'X-Parse-Javascript-Key': JAVASCRIPT_KEY,
  ...extra,
});

export const runFunctionOverRest = async (name, params, headers = {}) => {
  const response = await axios.post(`${process.env.SERVER_URL}/functions/${name}`, params, {
    headers: restHeaders(headers),
    validateStatus: () => true,
  });
  return response.data;
};

export const routeSessionLookupWithJavascriptKey = () => {
  const originalGet = axios.get.bind(axios);
  return spyOn(axios, 'get').and.callFake((url, config = {}) =>
    String(url).endsWith('/users/me')
      ? originalGet(url, { ...config, headers: { ...config.headers, ...restHeaders() } })
      : originalGet(url, config)
  );
};

export const answerSessionLookupWith = respond => {
  const originalGet = axios.get.bind(axios);
  return spyOn(axios, 'get').and.callFake((url, config) =>
    String(url).endsWith('/users/me') ? respond() : originalGet(url, config)
  );
};

export const seedRow = (className, fields) =>
  new Parse.Object(className, fields).save(null, MASTER);

export const ownerFields = owner => ({
  CreatedBy: pointer('_User', owner.account.id),
  ExtUserPtr: pointer('contracts_Users', owner.extUser.id),
});

export const seedDocument = (owner, fields = {}) =>
  seedRow('contracts_Document', {
    Name: 'Contract',
    URL: fileUrl('contract.pdf'),
    ...ownerFields(owner),
    ...fields,
  });

export const seedTemplate = (owner, fields = {}) =>
  seedRow('contracts_Template', {
    Name: 'Template',
    URL: fileUrl('template.pdf'),
    ...ownerFields(owner),
    ...fields,
  });

export const seedContact = (owner, signerAccount, fields = {}) =>
  seedRow('contracts_Contactbook', {
    Name: 'Signer',
    Email: signerAccount.email,
    UserId: pointer('_User', signerAccount.id),
    CreatedBy: pointer('_User', owner.account.id),
    ...fields,
  });

export const reload = (className, objectId) => new Parse.Query(className).get(objectId, MASTER);

export const aclOf = async (className, objectId) =>
  (await reload(className, objectId)).getACL()?.toJSON() ?? null;

export const waitForAcl = (className, objectId) =>
  waitUntil(async () => (await aclOf(className, objectId)) !== null);

export const readWriteFor = (...userIds) =>
  Object.fromEntries(userIds.map(id => [id, { read: true, write: true }]));

export const canReadRow = async (sessionToken, className, objectId) => {
  const response = await axios.get(`${process.env.SERVER_URL}/classes/${className}/${objectId}`, {
    headers: restHeaders({ 'X-Parse-Session-Token': sessionToken }),
    validateStatus: () => true,
  });
  return response.status === 200 && response.data.objectId === objectId;
};

export const documentCountOf = async extUser =>
  (await reload('contracts_Users', extUser.id)).get('DocumentCount') ?? 0;

export const waitForDocumentCount = (extUser, expected) =>
  waitUntil(async () => (await documentCountOf(extUser)) === expected);

export const countRows = (className, field, value) =>
  new Parse.Query(className).equalTo(field, value).count(MASTER);
