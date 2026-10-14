import { escapeHtml, toMailSubject } from './mailRendering.js';

const MAX_RECIPIENTS = 10;
const MAX_RECIPIENT_ENTRIES = MAX_RECIPIENTS * 2;
const MAX_ADDRESS_LENGTH = 254;
const MAIL_FAILURE = 400;
const MAIL_FAILURE_MESSAGE = 'Could not send the document copy.';
const THEME_COLOR = '#47a3ad';
const SINGLE_ADDRESS =
  /^[^\s@,;<>"'()\\\x00-\x1f\x7f\u2028\u2029]+@[^\s@,;<>"'()\\\x00-\x1f\x7f\u2028\u2029]+\.[^\s@,;<>"'()\\\x00-\x1f\x7f\u2028\u2029]+$/;
const DISPLAY_NAME_MARKUP = /[<>"]/g;

const invalidRecipients = () =>
  new Parse.Error(Parse.Error.INVALID_QUERY, 'please provide valid recipients.');

const isSingleAddress = address =>
  typeof address === 'string' &&
  address.length <= MAX_ADDRESS_LENGTH &&
  SINGLE_ADDRESS.test(address);

const withoutRepeats = addresses => {
  const seen = new Set();
  return addresses.filter(address => {
    const key = address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const normalizeRecipients = recipients => {
  if (!Array.isArray(recipients) || recipients.length > MAX_RECIPIENT_ENTRIES) {
    throw invalidRecipients();
  }
  const trimmed = recipients.map(address =>
    typeof address === 'string' ? address.trim() : address
  );
  if (!trimmed.every(isSingleAddress)) throw invalidRecipients();
  const unique = withoutRepeats(trimmed);
  if (unique.length < 1 || unique.length > MAX_RECIPIENTS) throw invalidRecipients();
  return unique;
};

const contactSentence = replyTo =>
  replyTo
    ? ` For any queries regarding this email, please contact the sender ${escapeHtml(replyTo)} directly.`
    : '';

const renderHtml = ({ docName, replyTo, tenantAppName }) =>
  `<html><head><meta http-equiv='Content-Type' content='text/html; charset=UTF-8'/></head><body><div style='background-color:#f5f5f5;padding:20px'><div style='background-color:white'><div>` +
  `<p style='padding:20px;font-family:system-ui;font-size:22px;font-weight:700;color:#1a1a1a'>${escapeHtml(tenantAppName)}</p></div><div style='padding:2px;font-family:system-ui;background-color:${THEME_COLOR}'><p style='font-size:20px;font-weight:400;color:white;padding-left:20px'>Document Copy</p></div><div>` +
  `<p style='padding:20px;font-family:system-ui;font-size:14px'>A copy of the document <strong>${escapeHtml(docName)}</strong> is attached to this email. Kindly download the document from the attachment.</p>` +
  `</div></div><div><p>This is an automated email from ${escapeHtml(tenantAppName)}.${contactSentence(replyTo)}</p></div></div></body></html>`;

export const buildForwardMail = ({
  extUserId,
  docName,
  url,
  recipient,
  from,
  senderName,
  replyTo,
  tenantAppName,
}) => ({
  extUserId,
  pdfName: docName,
  url,
  recipient,
  subject: toMailSubject(`${senderName} has signed the doc - ${docName}`),
  replyto: replyTo,
  from,
  html: renderHtml({ docName, replyTo, tenantAppName }),
});

const toDisplayName = value => toMailSubject(value).replace(DISPLAY_NAME_MARKUP, '').trim();

const validReplyAddress = candidate =>
  typeof candidate === 'string' && isSingleAddress(candidate.trim()) ? candidate.trim() : '';

export const resolveSender = (document, user, tenantAppName) => {
  const profile = document?.ExtUserPtr;
  const senderName =
    document?.SenderName || profile?.Name || user.get('name') || tenantAppName || '';
  return {
    senderName,
    replyTo: validReplyAddress(document?.SenderMail || profile?.Email || user.get('email')),
    from: toDisplayName(document?.SenderName || profile?.Email || user.get('email') || senderName),
    tenantAppName: tenantAppName || '',
  };
};

export const summarizeDeliveries = outcomes => {
  const failed = outcomes.filter(({ isSent }) => !isSent);
  const sentCount = outcomes.length - failed.length;
  if (failed.length === 0) return { status: 'success' };
  if (sentCount > 0) {
    return {
      status: 'partial',
      sentCount,
      failedCount: failed.length,
      failedRecipients: failed.map(({ recipient }) => recipient),
    };
  }
  const thrown = failed.find(({ error }) => error);
  if (thrown) {
    console.log('Err in forwardDoc mail delivery', thrown.error);
    throw new Parse.Error(MAIL_FAILURE, MAIL_FAILURE_MESSAGE);
  }
  return { status: 'error' };
};
