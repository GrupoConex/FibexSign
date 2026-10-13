import { generateId } from '../../Utils.js';
import { setDocumentCount } from '../../utils/CountUtils.js';
import {
  contactReferencesOf,
  parseBatchDocuments,
  toDraftInput,
} from './shared/batchDocumentInput.js';
import { dispatchBatchSigningMails, resolveInvitationBaseUrl } from './shared/batchSigningMail.js';
import { resolveCallerProfile } from './shared/callerProfile.js';
import { assertContactClaimsMatch } from './shared/contactClaims.js';
import { buildAuthorizedDocument, findAccessibleTemplate } from './shared/documentDraft.js';
import { createUserCallLimiter } from './shared/userCallLimiter.js';

const MASTER = { useMasterKey: true };
const TENANT_CLASS = 'partners_Tenant';
const BULK_SEND_TYPE = 'bulksend';
const BULK_SEND_TOKEN_LENGTH = 10;
const REQUEST_FIELDS = ['RequestBody', 'RequestSubject', 'EmailEditorType'];
const SENDER_FIELDS = ['SenderName', 'SenderMail'];
const DEFAULT_USER_LIMIT = 20;
const MAX_USER_LIMIT = 200;
const DEFAULT_USER_WINDOW_MS = 10 * 60 * 1000;

const userLimiter = createUserCallLimiter();

export const resetBatchDocumentsUserLimits = () => userLimiter.reset();

const positiveIntegerOr = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const assertWithinUserLimit = (userId, env = process.env) => {
  const limit = Math.min(
    positiveIntegerOr(env.BATCHDOCS_USER_LIMIT, DEFAULT_USER_LIMIT),
    MAX_USER_LIMIT
  );
  const windowMs = positiveIntegerOr(env.BATCHDOCS_USER_WINDOW_MS, DEFAULT_USER_WINDOW_MS);
  if (!userLimiter.tryConsume(userId, { limit, windowMs })) {
    throw new Parse.Error(Parse.Error.REQUEST_LIMIT_EXCEEDED, 'Too many bulk send requests');
  }
};

const memoize = (load, keyOf) => {
  const cache = new Map();
  return (...args) => {
    const key = keyOf(...args);
    if (!cache.has(key)) cache.set(key, load(...args));
    return cache.get(key);
  };
};

const loadTenant = profile => {
  const tenantId = profile.get('TenantId')?.id;
  if (!tenantId) return undefined;
  return new Parse.Query(TENANT_CLASS).equalTo('objectId', tenantId).first(MASTER);
};

const requestLookups = () => ({
  resolveProfile: memoize(resolveCallerProfile, (userId, extUserId) => `${userId}:${extUserId}`),
  findTemplate: memoize(findAccessibleTemplate, (userId, templateId) => `${userId}:${templateId}`),
  loadTenant: memoize(loadTenant, profile => profile.get('TenantId')?.id ?? ''),
});

const pickStrings = (source, fields) =>
  Object.fromEntries(
    fields
      .map(field => [field, source?.get(field)])
      .filter(([, value]) => typeof value === 'string' && value.length > 0)
  );

const hasRequestTemplate = template =>
  Boolean(template?.get('RequestBody') || template?.get('RequestSubject'));

const serverFields =
  ({ isBulkSend, lookups }) =>
  async ({ profile, template }) => ({
    DocSentAt: new Date(),
    ...(isBulkSend ? { BulkSendToken: generateId(BULK_SEND_TOKEN_LENGTH) } : {}),
    ...pickStrings(template, SENDER_FIELDS),
    ...pickStrings(
      hasRequestTemplate(template) ? template : await lookups.loadTenant(profile),
      REQUEST_FIELDS
    ),
  });

const buildDraft = async (context, item) => {
  await assertContactClaimsMatch(contactReferencesOf(item));
  return buildAuthorizedDocument({
    userId: context.userId,
    ip: context.ip,
    doc: toDraftInput(item),
    fields: serverFields(context),
    lookups: context.lookups,
  });
};

const saveDrafts = async drafts => {
  try {
    await Parse.Object.saveAll(
      drafts.map(draft => draft.document),
      MASTER
    );
    return drafts;
  } catch (error) {
    const saved = drafts.filter(draft => Boolean(draft.document.id));
    if (saved.length === 0) throw error;
    console.log('batchdoc partial save failure: ', error);
    return saved;
  }
};

const countsByProfile = drafts =>
  drafts.reduce(
    (counts, { profile }) => ({ ...counts, [profile.id]: (counts[profile.id] ?? 0) + 1 }),
    {}
  );

const chargeProfiles = drafts =>
  Promise.all(
    Object.entries(countsByProfile(drafts)).map(([profileId, count]) =>
      setDocumentCount(profileId, count)
    )
  );

const createBatch = async (request, items) => {
  const context = {
    userId: request.user.id,
    ip: request.headers?.['x-real-ip'],
    isBulkSend: request.headers?.type === BULK_SEND_TYPE,
    lookups: requestLookups(),
  };
  const drafts = await Promise.all(items.map(item => buildDraft(context, item)));
  const saved = await saveDrafts(drafts);
  await chargeProfiles(saved);
  dispatchBatchSigningMails({
    documentIds: saved.map(draft => draft.document.id),
    publicUrl: resolveInvitationBaseUrl(request.headers),
  });
  return { total: items.length, created: saved.length, failed: items.length - saved.length };
};

const toClientError = error =>
  error instanceof Parse.Error
    ? error
    : new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, 'Something went wrong.');

export default async function createBatchDocs(request) {
  if (!request.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
  }
  assertWithinUserLimit(request.user.id);
  const items = parseBatchDocuments(request.params?.Documents);
  try {
    return await createBatch(request, items);
  } catch (error) {
    console.log('createbatchdoc error: ', error);
    throw toClientError(error);
  }
}
