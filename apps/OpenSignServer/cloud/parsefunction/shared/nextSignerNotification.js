import { COMPLETION_ACTIVITIES } from '../../../utils/workflowUtils.js';
import { deliverMailv3 } from '../sendMailv3.js';
import { buildSignerInvitationMail, getPlaceholderRole } from './signerInvitationMail.js';

const FAILURE_LOG_MESSAGE = 'next signer notification failed';
const NO_RECIPIENT_LOG_MESSAGE = 'next signer notification skipped: no recipient';
const SKIPPED_LOG_MESSAGE = 'next signer notification skipped: PUBLIC_URL not configured';

const trimTrailingSlash = url => url.replace(/\/$/, '');

const toSafeHttpsOrigin = value => {
  try {
    const url = new URL(value);
    const isSafe = url.protocol === 'https:' && !url.username && !url.password;
    return isSafe ? url.origin : '';
  } catch {
    return '';
  }
};

export const resolveSigningBaseUrl = headers => {
  const configured = process.env.PUBLIC_URL;
  if (process.env.NODE_ENV === 'production') {
    return configured ? toSafeHttpsOrigin(configured) : '';
  }
  if (configured) return trimTrailingSlash(configured);
  return headers?.public_url ? trimTrailingSlash(headers.public_url) : '';
};

export const hasSignerActed = (auditTrail, contactId) =>
  (auditTrail || []).some(
    entry =>
      entry?.UserPtr?.objectId === contactId && COMPLETION_ACTIVITIES.includes(entry?.Activity)
  );

const placeholderContactId = placeholder =>
  placeholder?.signerObjId || placeholder?.signerPtr?.objectId;

const isAwaitingSignature = (placeholder, auditTrail) =>
  getPlaceholderRole(placeholder) !== 'viewer' &&
  !hasSignerActed(auditTrail, placeholderContactId(placeholder));

export function findNextSigner(document, signerObjectId, auditTrail) {
  const participants = (document?.Placeholders || []).filter(
    placeholder => placeholder?.Role !== 'prefill'
  );
  const currentIndex = participants.findIndex(
    placeholder => signerObjectId && placeholderContactId(placeholder) === signerObjectId
  );
  if (currentIndex < 0) return undefined;
  return participants
    .slice(currentIndex + 1)
    .find(placeholder => isAwaitingSignature(placeholder, auditTrail));
}

const isNotificationSuppressed = ({ document, isCompleted, sendNextMail }) =>
  isCompleted ||
  sendNextMail === false ||
  document?.SendinOrder !== true ||
  document?.IsSendMail === false;

export async function notifyNextSigner({
  document,
  signerObjectId,
  auditTrail,
  isCompleted,
  sendNextMail,
  publicUrl,
  deliver = deliverMailv3,
}) {
  if (isNotificationSuppressed({ document, isCompleted, sendNextMail })) return;
  const placeholder = findNextSigner(document, signerObjectId, auditTrail);
  if (!placeholder) return;
  if (!publicUrl) {
    console.log(SKIPPED_LOG_MESSAGE);
    return;
  }
  try {
    const params = buildSignerInvitationMail({ document, placeholder, publicUrl });
    if (!params.recipient?.trim()) {
      console.log(NO_RECIPIENT_LOG_MESSAGE);
      return;
    }
    const result = await deliver({ params });
    if (result?.status === 'error') console.log(FAILURE_LOG_MESSAGE);
  } catch {
    console.log(FAILURE_LOG_MESSAGE);
  }
}
