import { setDocumentCount } from '../../utils/CountUtils.js';
import { resolveCallerProfile } from './shared/callerProfile.js';
import { authorizeContactPointers } from './shared/contactAuthorization.js';
import { authorizePlaceholders } from './shared/placeholderAuthorization.js';
import { buildPrivateAcl } from './shared/recordAcl.js';
import { loadCallerAccess } from './shared/sendMailv3Authorization.js';
import { buildAccessibleTemplateQuery, templateContactIds } from './shared/templateAccess.js';

const DOCUMENT_CLASS = 'contracts_Document';
const MASTER = { useMasterKey: true };
const DEFAULT_NAME = 'untitled document';
const FLAGS_DEFAULT_FALSE = [
  'SentToOthers',
  'SendinOrder',
  'IsEnableOTP',
  'IsTourEnabled',
  'AllowModifications',
  'AutomaticReminders',
  'NotifyOnSignatures',
];
const OPTIONAL_TEXT_FIELDS = ['Description', 'Note', 'SignedUrl', 'RedirectUrl'];
const OPTIONAL_NUMBER_FIELDS = ['TimeToCompleteDays', 'RemindOnceInEvery'];
const OPTIONAL_LIST_FIELDS = ['Signers', 'Placeholders', 'SignatureType', 'Bcc', 'Cc', 'PenColors'];

const isUsableId = id => typeof id === 'string' && id.length > 0;

const asArray = value => (Array.isArray(value) ? value : []);

const pointerId = value => value?.id ?? value?.objectId;

const toPointer = (className, objectId) => ({ __type: 'Pointer', className, objectId });

const templateIdOf = templateRef => {
  const templateId = typeof templateRef === 'string' ? templateRef : pointerId(templateRef);
  return isUsableId(templateId) ? templateId : undefined;
};

const defaultedFlags = doc => ({
  ...Object.fromEntries(
    FLAGS_DEFAULT_FALSE.map(flag => [flag, doc[flag] !== undefined ? doc[flag] : false])
  ),
  SendInOrderStrict: doc.SendInOrderStrict !== undefined ? !!doc.SendInOrderStrict : false,
});

const pickFields = (doc, fields, isPresent, convert = value => value) =>
  Object.fromEntries(
    fields.filter(field => isPresent(doc[field])).map(field => [field, convert(doc[field])])
  );

const optionalFields = (doc, recipients, template) => ({
  ...pickFields(doc, OPTIONAL_TEXT_FIELDS, Boolean),
  ...pickFields(doc, OPTIONAL_NUMBER_FIELDS, value => value !== undefined, Number),
  ...pickFields(
    { ...doc, ...recipients },
    OPTIONAL_LIST_FIELDS,
    value => asArray(value).length > 0
  ),
  ...(doc.DocSentAt?.iso ? { DocSentAt: new Date(doc.DocSentAt.iso) } : {}),
  ...(template ? { TemplateId: toPointer('contracts_Template', template.id) } : {}),
});

const mapDocumentPayload = (doc, recipients, template) => ({
  Name: doc.Name || DEFAULT_NAME,
  URL: doc.URL,
  ...defaultedFlags(doc),
  ...optionalFields(doc, recipients, template),
});

const findAccessibleTemplate = async (userId, templateRef) => {
  const templateId = templateIdOf(templateRef);
  if (!templateId) return undefined;
  const access = await loadCallerAccess(userId);
  return buildAccessibleTemplateQuery({ userId, access, templateId }).first(MASTER);
};

const authorizeRecipients = async (userId, doc, template) => {
  const allowedContactIds = template ? templateContactIds(template) : [];
  const authorize = pointers =>
    authorizeContactPointers({ userId, pointers, templateContactIds: allowedContactIds });
  const signers = await authorize(doc.Signers);
  const bcc = await authorize(doc.Bcc);
  const cc = await authorize(doc.Cc);
  const placeholders = await authorizePlaceholders({
    userId,
    placeholders: doc.Placeholders,
    templateContactIds: allowedContactIds,
  });
  return {
    signerUserIds: signers.signerUserIds,
    recipients: {
      Signers: signers.pointers,
      Bcc: bcc.pointers,
      Cc: cc.pointers,
      Placeholders: placeholders,
    },
  };
};

const buildDocument = async (request, doc) => {
  const userId = request.user.id;
  const profile = await resolveCallerProfile(userId, pointerId(doc.ExtUserPtr));
  const template = await findAccessibleTemplate(userId, doc.TemplateId);
  const { signerUserIds, recipients } = await authorizeRecipients(userId, doc, template);
  const document = new Parse.Object(DOCUMENT_CLASS);
  document.set({
    ...mapDocumentPayload(doc, recipients, template),
    ExtUserPtr: toPointer('contracts_Users', profile.id),
    CreatedBy: toPointer('_User', userId),
    OriginIp: request?.headers?.['x-real-ip'] || '',
  });
  document.setACL(buildPrivateAcl([userId, ...signerUserIds]));
  return { document, extUserId: profile.id };
};

export default async function createDocumentFromApp(request) {
  const doc = request.params?.document;
  if (!doc) {
    throw new Parse.Error(Parse.Error.INVALID_JSON, 'Missing document payload.');
  }
  if (!request.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
  }
  try {
    const { document, extUserId } = await buildDocument(request, doc);
    const docRes = await document.save(null, MASTER);
    setDocumentCount(extUserId);
    return docRes;
  } catch (error) {
    console.log('error in create document from app: ', error);
    throw error;
  }
}
