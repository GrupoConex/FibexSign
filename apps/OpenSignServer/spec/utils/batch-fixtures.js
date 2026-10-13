import { settleBatchMailDispatches } from '../../cloud/parsefunction/shared/batchSigningMail.js';
import { pointer } from './auth-fixtures.js';
import { runFunctionOverRest, trustedFileUrl } from './document-fixtures.js';

const MASTER = { useMasterKey: true };
const DOCUMENT_CLASS = 'contracts_Document';
const TEMPLATE_INCLUDES = [
  'ExtUserPtr',
  'Signers',
  'CreatedBy',
  'ExtUserPtr.TenantId',
  'Placeholders.signerPtr',
  'Bcc',
  'Cc',
];

export const BATCH_FUNCTION = 'batchdocuments';

const toJson = parseObject => JSON.parse(JSON.stringify(parseObject));

export const sendBatchRaw = (Documents, account, headers = {}) =>
  runFunctionOverRest(
    BATCH_FUNCTION,
    { Documents },
    {
      ...(account ? { 'X-Parse-Session-Token': account.sessionToken } : {}),
      ...headers,
    }
  );

export const sendBatch = async (documents, account, headers = {}) => {
  const body = await sendBatchRaw(JSON.stringify(documents), account, headers);
  if (body.error) throw new Parse.Error(body.code, body.error);
  await settleBatchMailDispatches();
  return body.result;
};

export const templateItem = async template =>
  toJson(
    await new Parse.Query('contracts_Template').include(TEMPLATE_INCLUDES).get(template.id, MASTER)
  );

export const pickedContact = contact => toJson(contact);

export const contactPlaceholder = (role, contactJson, id = 1) => ({
  Id: id,
  Role: role,
  signerObjId: contactJson.objectId,
  signerPtr: contactJson,
  placeHolder: [],
});

export const emailPlaceholder = (role, email, id = 1) => ({
  Id: id,
  Role: role,
  email,
  signerObjId: '',
  signerPtr: '',
  placeHolder: [],
});

export const plainDocument = (fields = {}) => ({
  Name: 'Bulk contract',
  URL: trustedFileUrl('bulk.pdf'),
  ...fields,
});

export const documentsCreatedBy = account =>
  new Parse.Query(DOCUMENT_CLASS)
    .equalTo('CreatedBy', pointer('_User', account.id))
    .include(['Signers', 'ExtUserPtr'])
    .find(MASTER);

export const countDocumentsOf = account =>
  new Parse.Query(DOCUMENT_CLASS).equalTo('CreatedBy', pointer('_User', account.id)).count(MASTER);
