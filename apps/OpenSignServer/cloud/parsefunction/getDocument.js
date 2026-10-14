import axios from 'axios';
import { cloudServerUrl, serverAppId } from '../../Utils.js';
import {
  OBJECT_METADATA,
  isRecord,
  pick,
  projectCopyRecipient,
  projectOwnerSigner,
  projectSigner,
  toPointer,
} from './shared/contactProjection.js';

const MASTER = { useMasterKey: true };
const SESSION_LOOKUP_TIMEOUT_MS = 5000;
const SESSION_LOOKUP_RETRIES = 1;
const OWNER_INCLUDES = ['Bcc', 'Cc'];
const SESSION_TOKEN_PREFIX = 'r:';
export const RETURNED_FIELDS = [
  'Name',
  'URL',
  'ExtUserPtr',
  'CreatedBy',
  'ExpiryDate',
  'Note',
  'EnableEmailOTP',
  'Signers',
  'Type',
  'Description',
  'SignedUrl',
  'AuditTrail',
  'Placeholders',
  'Folder',
  'SendinOrder',
  'AutomaticReminders',
  'IsCompleted',
  'IsDeclined',
  'RemindOnceInEvery',
  'TimeToCompleteDays',
  'SentToOthers',
  'EnablePhoneOTP',
  'AgreementValidUntil',
  'Recipients',
  'Clauses',
  'AgreementDelta',
  'IsArchive',
  'SendMail',
  'SendCompletionMail',
  'DeclineReason',
  'IsSignyourself',
  'DeclineBy',
  'IsEnableOTP',
  'IsTourEnabled',
  'SignatureType',
  'NotifyOnSignatures',
  'RedirectUrl',
  'AllowModifications',
  'PenColors',
  'SenderName',
  'SenderMail',
  'SendInOrderStrict',
  'SharedWithUsers',
  'DocSentAt',
];
export const INTERNAL_FIELDS = ['ACL', 'OriginIp', 'DebugginLog', 'FileAdapterId'];
export const NON_OWNER_FIELDS = [
  ...OWNER_INCLUDES,
  'RequestBody',
  'RequestSubject',
  'EmailEditorType',
  'NextReminderDate',
  'TemplateId',
];
const SENDER_PROFILE_FIELDS = [
  'Name',
  'Email',
  'Phone',
  'Company',
  'JobTitle',
  'UseNameAsSender',
  'SignatureType',
  'DateFormat',
  'WidgetPreferences',
  'HeaderDocId',
  'DownloadFilenameFormat',
];
const SENDER_PROFILE_POINTERS = ['UserId', 'TenantId'];

const noAccess = () => ({ error: "You don't have access of this document!" });

const projectSenderProfile = profile => ({
  ...pick(profile, [...OBJECT_METADATA, ...SENDER_PROFILE_FIELDS]),
  ...Object.fromEntries(
    SENDER_PROFILE_POINTERS.filter(key => profile?.[key] !== undefined).map(key => [
      key,
      toPointer(profile[key]),
    ])
  ),
});

const projectAuditEntry = entry =>
  isRecord(entry)
    ? {
        ...pick(entry, ['Activity']),
        ...(entry.UserPtr
          ? { UserPtr: pick(entry.UserPtr, [...OBJECT_METADATA, 'Email', 'Name']) }
          : {}),
      }
    : entry;

const isEmbeddedRecord = reference =>
  isRecord(reference) && Object.keys(reference).some(key => !OBJECT_METADATA.includes(key));

const projectEmbeddedSigner = signerPtr => (signerPtr.objectId ? toPointer(signerPtr) : {});

const projectPlaceholder = placeholder =>
  isEmbeddedRecord(placeholder?.signerPtr)
    ? { ...placeholder, signerPtr: projectEmbeddedSigner(placeholder.signerPtr) }
    : placeholder;

const mapEntries = project => entries => (Array.isArray(entries) ? entries.map(project) : []);

const fieldProjections = isOwner => [
  ['CreatedBy', creator => toPointer(creator, '_User')],
  ['ExtUserPtr', projectSenderProfile],
  ['DeclineBy', decliner => pick(decliner, [...OBJECT_METADATA, 'email'])],
  ['AuditTrail', mapEntries(projectAuditEntry)],
  ['Placeholders', mapEntries(projectPlaceholder)],
  ['Signers', mapEntries(isOwner ? projectOwnerSigner : projectSigner)],
  ...(isOwner ? OWNER_INCLUDES.map(field => [field, mapEntries(projectCopyRecipient)]) : []),
];

const withoutFields = (document, hiddenFields) =>
  Object.fromEntries(Object.entries(document).filter(([field]) => !hiddenFields.includes(field)));

export const projectDocument = (document, isOwner) =>
  withoutFields(
    fieldProjections(isOwner).reduce(
      (projected, [field, project]) =>
        projected[field] === undefined || projected[field] === null
          ? projected
          : { ...projected, [field]: project(projected[field]) },
      document
    ),
    isOwner ? INTERNAL_FIELDS : [...INTERNAL_FIELDS, ...NON_OWNER_FIELDS]
  );

const allowedIncludesOf = include =>
  [
    ...new Set(
      String(include || '')
        .split(',')
        .map(path => path.trim())
    ),
  ].filter(path => OWNER_INCLUDES.includes(path));

const buildDocumentQuery = (docId, extraIncludes = []) => {
  const query = new Parse.Query('contracts_Document');
  query.equalTo('objectId', docId);
  query.include('ExtUserPtr');
  query.include('ExtUserPtr.TenantId');
  query.include('CreatedBy');
  query.include('Signers');
  query.include('AuditTrail.UserPtr');
  query.include('Placeholders');
  query.include('DeclineBy');
  query.notEqualTo('IsArchive', true);
  extraIncludes.forEach(path => query.include(path));
  return query;
};

const isTransientFailure = err => err?.response?.status === undefined || err.response.status >= 500;

const lookupSessionUser = sessiontoken =>
  axios.get(cloudServerUrl + '/users/me', {
    headers: {
      'X-Parse-Application-Id': serverAppId,
      'X-Parse-Session-Token': sessiontoken,
    },
    timeout: SESSION_LOOKUP_TIMEOUT_MS,
  });

const resolveSessionUserId = async (sessiontoken, retriesLeft = SESSION_LOOKUP_RETRIES) => {
  if (!sessiontoken) return undefined;
  try {
    return (await lookupSessionUser(sessiontoken)).data?.objectId;
  } catch (err) {
    if (retriesLeft > 0 && isTransientFailure(err)) {
      return resolveSessionUserId(sessiontoken, retriesLeft - 1);
    }
    console.log('session lookup failed', err?.response?.status ?? err?.code);
    return undefined;
  }
};

const isOwnedBy = (document, userId) => Boolean(userId) && document.get('CreatedBy')?.id === userId;

const canReadWith = (document, userId) => {
  const acl = document.getACL();
  return Boolean(userId && acl && acl.getReadAccess(userId));
};

const resolveCallerId = async request => {
  if (request.user?.id) return request.user.id;
  const sessiontoken = request.headers?.sessiontoken;
  return typeof sessiontoken === 'string' && sessiontoken.startsWith(SESSION_TOKEN_PREFIX)
    ? resolveSessionUserId(sessiontoken)
    : undefined;
};

const readDocument = async (docId, includes, userId) => {
  const res = await buildDocumentQuery(docId).first(MASTER);
  if (!res) return { error: "document deleted or you don't have access." };
  if ((res.get('IsEnableOTP') || false) && !canReadWith(res, userId)) return noAccess();
  const isOwner = isOwnedBy(res, userId);
  const source =
    includes.length > 0 && isOwner ? await buildDocumentQuery(docId, includes).first(MASTER) : res;
  return projectDocument(JSON.parse(JSON.stringify(source)), isOwner);
};

export default async function getDocument(request) {
  const docId = request.params.docId;
  if (!docId) return { error: 'Please pass required parameters!' };
  const includes = allowedIncludesOf(request?.params?.include);
  try {
    return await readDocument(docId, includes, await resolveCallerId(request));
  } catch (err) {
    console.log('err', err);
    return noAccess();
  }
}
