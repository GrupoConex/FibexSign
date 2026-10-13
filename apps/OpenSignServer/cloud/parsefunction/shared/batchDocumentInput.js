import { emailRegex } from '../../../Utils.js';
import { contactIdOf, toContactPointer } from './contactAuthorization.js';
import { isParticipantPlaceholder } from './signerInvitationMail.js';
import { isTrustedStorageUrl } from './storageUrlPolicy.js';

export const MAX_BATCH_DOCUMENTS = 50;
export const MAX_PARTICIPANTS = 10;
export const MAX_COPY_RECIPIENTS = 10;
export const MAX_RECIPIENTS_PER_CALL = 500;

const DEFAULT_REMIND_DAYS = 5;
const DEFAULT_COMPLETION_DAYS = 15;
const TEXT_FIELDS = ['Name', 'Note', 'Description', 'RedirectUrl'];
const FLAG_FIELDS = [
  'SendInOrderStrict',
  'AutomaticReminders',
  'IsEnableOTP',
  'IsTourEnabled',
  'AllowModifications',
  'NotifyOnSignatures',
];
const LIST_FIELDS = ['SignatureType', 'PenColors'];
const PLACEHOLDER_FIELDS = [
  'Id',
  'Role',
  'role',
  'SignerRole',
  'signer_role',
  'blockColor',
  'placeHolder',
];

const invalidDocuments = () =>
  new Parse.Error(
    Parse.Error.INVALID_JSON,
    `Documents must be a JSON array of 1 to ${MAX_BATCH_DOCUMENTS} documents with trusted urls, ` +
      `at most ${MAX_PARTICIPANTS} signers and ${MAX_COPY_RECIPIENTS} copies each ` +
      `and ${MAX_RECIPIENTS_PER_CALL} recipients in total.`
  );

const isUsableString = value => typeof value === 'string' && value.length > 0;

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const asArray = value => (Array.isArray(value) ? value : []);

const isEmptyReference = value =>
  value === undefined ||
  value === null ||
  value === '' ||
  (isPlainObject(value) && Object.keys(value).length === 0);

const normalizeEmail = value => (typeof value === 'string' ? value.trim().toLowerCase() : '');

const parseJson = raw => {
  try {
    return JSON.parse(raw);
  } catch {
    throw invalidDocuments();
  }
};

const participantsOf = item => asArray(item.Placeholders).filter(isParticipantPlaceholder);

const isEmailPlaceholder = placeholder => isEmptyReference(placeholder?.signerPtr);

const hasValidEmails = item =>
  participantsOf(item)
    .filter(isEmailPlaceholder)
    .every(placeholder => emailRegex.test(normalizeEmail(placeholder?.email)));

const recipientCountOf = item =>
  participantsOf(item).length + asArray(item.Bcc).length + asArray(item.Cc).length;

const isDocumentItem = item =>
  isPlainObject(item) &&
  isUsableString(item.URL) &&
  isTrustedStorageUrl(item.URL) &&
  participantsOf(item).length <= MAX_PARTICIPANTS &&
  asArray(item.Bcc).length <= MAX_COPY_RECIPIENTS &&
  asArray(item.Cc).length <= MAX_COPY_RECIPIENTS &&
  hasValidEmails(item);

const isWithinCallLimits = documents =>
  Array.isArray(documents) &&
  documents.length > 0 &&
  documents.length <= MAX_BATCH_DOCUMENTS &&
  documents.every(isDocumentItem) &&
  documents.reduce((total, item) => total + recipientCountOf(item), 0) <= MAX_RECIPIENTS_PER_CALL;

export const parseBatchDocuments = raw => {
  const documents = typeof raw === 'string' ? parseJson(raw) : raw;
  if (!isWithinCallLimits(documents)) throw invalidDocuments();
  return documents;
};

const positiveIntegerOr = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const pickBy = (source, fields, isAllowed) =>
  Object.fromEntries(
    fields.filter(field => isAllowed(source?.[field])).map(field => [field, source[field]])
  );

const toReference = value => {
  const isUntypedContact = isPlainObject(value) && !value.__type && isUsableString(value.objectId);
  return isUntypedContact ? toContactPointer(value.objectId) : value;
};

const toPlaceholder = placeholder => {
  const known = pickBy(placeholder, PLACEHOLDER_FIELDS, value => value !== undefined);
  if (isEmailPlaceholder(placeholder)) {
    return { ...known, signerObjId: '', signerPtr: {}, email: normalizeEmail(placeholder?.email) };
  }
  const signerPtr = toReference(placeholder.signerPtr);
  return { ...known, signerObjId: contactIdOf(signerPtr) ?? '', signerPtr };
};

const signersOf = placeholders => {
  const ids = placeholders.map(placeholder => contactIdOf(placeholder.signerPtr)).filter(Boolean);
  return [...new Set(ids)].map(toContactPointer);
};

const copyRecipients = value =>
  asArray(value)
    .filter(entry => !isEmptyReference(entry))
    .map(toReference);

const profilePointer = profile =>
  isUsableString(profile?.objectId)
    ? { __type: 'Pointer', className: 'contracts_Users', objectId: profile.objectId }
    : undefined;

export const toDraftInput = item => {
  const placeholders = participantsOf(item).map(toPlaceholder);
  return {
    URL: item.URL,
    SignedUrl: item.URL,
    SentToOthers: true,
    SendinOrder: item.SendinOrder !== false,
    ...pickBy(item, TEXT_FIELDS, isUsableString),
    ...Object.fromEntries(FLAG_FIELDS.map(flag => [flag, item[flag] === true])),
    ...pickBy(item, LIST_FIELDS, Array.isArray),
    RemindOnceInEvery: positiveIntegerOr(item.RemindOnceInEvery, DEFAULT_REMIND_DAYS),
    TimeToCompleteDays: positiveIntegerOr(item.TimeToCompleteDays, DEFAULT_COMPLETION_DAYS),
    TemplateId: isUsableString(item.objectId) ? item.objectId : undefined,
    ExtUserPtr: profilePointer(item.ExtUserPtr),
    Placeholders: placeholders,
    Signers: signersOf(placeholders),
    Bcc: copyRecipients(item.Bcc),
    Cc: copyRecipients(item.Cc),
  };
};

export const contactReferencesOf = item =>
  [
    ...asArray(item.Placeholders).map(placeholder => placeholder?.signerPtr),
    ...asArray(item.Signers),
    ...asArray(item.Bcc),
    ...asArray(item.Cc),
  ].filter(reference => isPlainObject(reference) && !isEmptyReference(reference));
