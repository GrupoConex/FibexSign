import axios from 'axios';
import { cloudServerUrl, serverAppId } from '../../Utils.js';

const MASTER = { useMasterKey: true };
const SESSION_LOOKUP_TIMEOUT_MS = 5000;
const OWNER_INCLUDES = ['Bcc', 'Cc'];
const OBJECT_METADATA = ['__type', 'className', 'objectId'];
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

const pick = (source, keys) =>
  Object.fromEntries(
    keys.filter(key => source?.[key] !== undefined).map(key => [key, source[key]])
  );

const toPointer = (reference, className = reference?.className) =>
  reference?.objectId ? { __type: 'Pointer', className, objectId: reference.objectId } : reference;

const projectSenderProfile = profile => ({
  ...pick(profile, [...OBJECT_METADATA, ...SENDER_PROFILE_FIELDS]),
  ...Object.fromEntries(
    SENDER_PROFILE_POINTERS.filter(key => profile?.[key] !== undefined).map(key => [
      key,
      toPointer(profile[key]),
    ])
  ),
});

const projectAuditTrail = trail =>
  Array.isArray(trail)
    ? trail.map(entry =>
        entry?.UserPtr
          ? { ...entry, UserPtr: pick(entry.UserPtr, [...OBJECT_METADATA, 'Email', 'Name']) }
          : entry
      )
    : trail;

const FIELD_PROJECTIONS = [
  ['CreatedBy', creator => toPointer(creator, '_User')],
  ['ExtUserPtr', projectSenderProfile],
  ['DeclineBy', decliner => pick(decliner, [...OBJECT_METADATA, 'email'])],
  ['AuditTrail', projectAuditTrail],
];

const projectDocument = document =>
  FIELD_PROJECTIONS.reduce(
    (projected, [field, project]) =>
      projected[field] === undefined || projected[field] === null
        ? projected
        : { ...projected, [field]: project(projected[field]) },
    document
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

const resolveSessionUserId = async sessiontoken => {
  if (!sessiontoken) return undefined;
  try {
    const userRes = await axios.get(cloudServerUrl + '/users/me', {
      headers: {
        'X-Parse-Application-Id': serverAppId,
        'X-Parse-Session-Token': sessiontoken,
      },
      timeout: SESSION_LOOKUP_TIMEOUT_MS,
    });
    return userRes.data?.objectId;
  } catch (err) {
    console.log('err user in not authenticated', err);
    return undefined;
  }
};

const isOwnedBy = (document, userId) => Boolean(userId) && document.get('CreatedBy')?.id === userId;

const canReadWith = (document, userId) => {
  const acl = document.getACL();
  return Boolean(userId && acl && acl.getReadAccess(userId));
};

const readDocument = async (docId, includes, sessiontoken) => {
  const res = await buildDocumentQuery(docId).first(MASTER);
  if (!res) return { error: "document deleted or you don't have access." };
  const isOtpEnabled = res.get('IsEnableOTP') || false;
  const userId =
    includes.length > 0 || isOtpEnabled ? await resolveSessionUserId(sessiontoken) : undefined;
  if (isOtpEnabled && !canReadWith(res, userId)) return noAccess();
  const source =
    includes.length > 0 && isOwnedBy(res, userId)
      ? await buildDocumentQuery(docId, includes).first(MASTER)
      : res;
  return projectDocument(JSON.parse(JSON.stringify(source)));
};

export default async function getDocument(request) {
  const docId = request.params.docId;
  if (!docId) return { error: 'Please pass required parameters!' };
  const includes = allowedIncludesOf(request?.params?.include);
  const sessiontoken = request?.headers?.sessiontoken || '';
  try {
    return await readDocument(docId, includes, sessiontoken);
  } catch (err) {
    console.log('err', err);
    return noAccess();
  }
}
