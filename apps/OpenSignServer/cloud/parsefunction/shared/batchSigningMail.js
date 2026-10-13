import { resolveCorsAllowedOrigins } from '../../../utils/corsOptions.js';
import { deliverMailv3 } from '../sendMailv3.js';
import { CommsLane } from './commsMailClient.js';
import { sanitizeDisplayName } from './mailDisplayName.js';
import { resolveSigningBaseUrl } from './nextSignerNotification.js';
import {
  buildSignerInvitationMail,
  getPlaceholderRole,
  isParticipantPlaceholder,
} from './signerInvitationMail.js';

const DOCUMENT_CLASS = 'contracts_Document';
const MASTER = { useMasterKey: true };
const MAIL_INCLUDES = ['ExtUserPtr', 'ExtUserPtr.TenantId', 'Signers', 'Placeholders.signerPtr'];
const BULK_DELIVERY = Object.freeze({ lane: CommsLane.BULK });
const MAIL_CONCURRENCY = 5;

const pendingDispatches = new Set();

const keepOnlyFirstSignerAndViewers = (document, placeholders) => {
  const firstSignerIndex = placeholders.findIndex(
    placeholder => getPlaceholderRole(placeholder) === 'signer'
  );
  const selected = placeholders.filter(
    (placeholder, idx) => getPlaceholderRole(placeholder) === 'viewer' || idx === firstSignerIndex
  );
  if (selected.length === 0 && document?.Placeholders?.length > 0) {
    return document.Placeholders.filter(isParticipantPlaceholder).slice(0, 1);
  }
  return selected;
};

const invitationRecipients = document => {
  const participants = (document.Placeholders || []).filter(isParticipantPlaceholder);
  return document.SendinOrder
    ? keepOnlyFirstSignerAndViewers(document, participants)
    : participants;
};

const buildInvitation = (document, placeholder, publicUrl) => {
  const params = buildSignerInvitationMail({ document, placeholder, publicUrl });
  if (!params) return null;
  return {
    params: {
      ...params,
      from: sanitizeDisplayName(params.from),
      extUserId: document.ExtUserPtr.objectId,
    },
  };
};

const deliverInvitation = async (document, placeholder, publicUrl, deliver) => {
  const invitation = buildInvitation(document, placeholder, publicUrl);
  if (!invitation) {
    console.log('batchdoc sendmail skipped: placeholder without an authorized recipient');
    return;
  }
  await deliver(invitation, BULK_DELIVERY);
};

export const sendMail = async (document, publicUrl, { deliver = deliverMailv3 } = {}) => {
  for (const placeholder of invitationRecipients(document)) {
    try {
      await deliverInvitation(document, placeholder, publicUrl, deliver);
    } catch (error) {
      console.log('batchdoc sendmail error: ', error);
    }
  }
};

export const resolveInvitationBaseUrl = headers => {
  const origin = headers?.origin;
  const isAllowedOrigin = Boolean(origin) && resolveCorsAllowedOrigins().includes(origin);
  return isAllowedOrigin ? origin : resolveSigningBaseUrl(headers);
};

const loadSavedDocuments = async documentIds => {
  const rows = await new Parse.Query(DOCUMENT_CLASS)
    .containedIn('objectId', documentIds)
    .include(MAIL_INCLUDES)
    .limit(documentIds.length)
    .find(MASTER);
  return rows.map(row => JSON.parse(JSON.stringify(row)));
};

const inChunks = (items, size) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size)
  );

export const sendBatchSigningMails = async ({ documentIds, publicUrl, deliver }) => {
  if (!publicUrl) {
    console.log('batchdoc mail skipped: signing base url is not configured');
    return;
  }
  const documents = await loadSavedDocuments(documentIds);
  for (const chunk of inChunks(documents, MAIL_CONCURRENCY)) {
    await Promise.all(chunk.map(document => sendMail(document, publicUrl, { deliver })));
  }
};

export const dispatchBatchSigningMails = request => {
  const dispatch = sendBatchSigningMails(request)
    .catch(error => console.log('batchdoc signing mail dispatch error: ', error))
    .finally(() => pendingDispatches.delete(dispatch));
  pendingDispatches.add(dispatch);
};

export const settleBatchMailDispatches = () => Promise.allSettled([...pendingDispatches]);
