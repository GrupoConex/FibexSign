import { setDocumentCount } from '../../utils/CountUtils.js';
import { loadContacts } from './shared/contactAuthorization.js';
import { buildPrivateAcl } from './shared/recordAcl.js';

const DOCUMENT_CLASS = 'contracts_Document';
const CONTACT_CLASS = 'contracts_Contactbook';
const MASTER = { useMasterKey: true };
const RESET_FLAGS = ['IsDeclined', 'IsCompleted'];
const EXCLUDED_FIELDS = [
  'DocSentAt',
  'SignedUrl',
  'AuditTrail',
  'DeclineBy',
  'DeclineReason',
  'DocumentHash',
  'CertificateUrl',
];

const findOwnSourceDocument = (docId, user) =>
  new Parse.Query(DOCUMENT_CLASS)
    .equalTo('objectId', docId)
    .equalTo('CreatedBy', user)
    .notEqualTo('IsArchive', true)
    .exclude(EXCLUDED_FIELDS)
    .first(MASTER);

const resetWidget = widget => {
  const { SignUrl, ...rest } = widget;
  return {
    ...rest,
    type: widget.type === 'text' ? 'text input' : widget.type,
    options: { ...widget.options, response: '', defaultValue: '' },
  };
};

const resetPlaceholders = placeholders =>
  placeholders.map(signer => ({
    ...signer,
    placeHolder: (signer.placeHolder || []).map(page => ({
      ...page,
      pos: (page.pos || []).map(resetWidget),
    })),
  }));

const copiedValue = (key, value) => {
  if (RESET_FLAGS.includes(key)) return false;
  if (key === 'Placeholders') return resetPlaceholders(value);
  return value;
};

const signerContactIds = source =>
  (source.get('Signers') ?? [])
    .filter(signer => signer?.className === CONTACT_CLASS)
    .map(signer => signer.id);

const copyAcl = async source => {
  const contacts = await loadContacts(signerContactIds(source));
  const signerUserIds = contacts.map(contact => contact.get('UserId')?.id);
  return buildPrivateAcl([source.get('CreatedBy')?.id, ...signerUserIds]);
};

const buildCopy = async source => {
  const { ACL, objectId, ...fields } = source.toJSON();
  const copy = new Parse.Object(DOCUMENT_CLASS);
  Object.entries(fields).forEach(([key, value]) => copy.set(key, copiedValue(key, value)));
  copy.setACL(await copyAcl(source));
  return { copy, extUserId: fields.ExtUserPtr?.objectId };
};

const loadRecreatableSource = async (docId, user) => {
  const source = await findOwnSourceDocument(docId, user);
  if (!source) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Document not found');
  }
  if (source.get('IsSignyourself')) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Signyourself Document not allowed');
  }
  return source;
};

export default async function recreateDocument(request) {
  const { docId } = request.params;
  if (typeof docId !== 'string' || !docId) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Missing docId parameter');
  }
  if (!request.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User not aunthenticated');
  }
  try {
    const source = await loadRecreatableSource(docId, request.user);
    const { copy, extUserId } = await buildCopy(source);
    const { objectId, createdAt, updatedAt } = (await copy.save(null, MASTER)).toJSON();
    setDocumentCount(extUserId);
    return { objectId, createdAt, updatedAt };
  } catch (err) {
    console.log('err in recreate document', err);
    throw err;
  }
}
