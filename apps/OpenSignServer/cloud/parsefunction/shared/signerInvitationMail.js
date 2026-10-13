import { emailRegex, mailTemplate } from '../../../Utils.js';
import { escapeHtml, mapValues, renderMailTemplate, toMailSubject } from './mailRendering.js';

const DEFAULT_COMPLETION_DAYS = 15;
const PREFILL_ROLE = 'prefill';
const HTML_BODY_PREFIX =
  "<html><head><meta http-equiv='Content-Type' content='text/html; charset=UTF-8' /></head><body>";
const HTML_BODY_SUFFIX = '</body></html>';

const toBase64 = value => Buffer.from(value, 'utf8').toString('base64');

const isUsableId = id => typeof id === 'string' && id.length > 0;

export const getPlaceholderRole = placeholder =>
  placeholder?.SignerRole || placeholder?.signer_role || placeholder?.role || 'signer';

export const isParticipantPlaceholder = placeholder => placeholder?.Role !== PREFILL_ROLE;

const formatExpiryDate = document => {
  const expiry = new Date(document.createdAt);
  expiry.setDate(expiry.getDate() + (document?.TimeToCompleteDays || DEFAULT_COMPLETION_DAYS));
  return expiry.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
};

const placeholderContactId = placeholder => {
  const pointerId = placeholder?.signerPtr?.objectId ?? placeholder?.signerPtr?.id;
  if (isUsableId(pointerId)) return pointerId;
  return isUsableId(placeholder?.signerObjId) ? placeholder.signerObjId : undefined;
};

const contactRecipient = (document, contactId) => {
  const contact = (document?.Signers || []).find(signer => signer?.objectId === contactId);
  if (!contact?.Email) return undefined;
  return { contactId, email: contact.Email, name: contact.Name || '', phone: contact.Phone || '' };
};

const emailRecipient = placeholder => {
  const email = typeof placeholder?.email === 'string' ? placeholder.email.trim() : '';
  return emailRegex.test(email) ? { contactId: undefined, email, name: '', phone: '' } : undefined;
};

const resolveRecipient = (document, placeholder) => {
  const contactId = placeholderContactId(placeholder);
  return contactId ? contactRecipient(document, contactId) : emailRecipient(placeholder);
};

const buildSigningUrl = (origin, documentId, recipient) => {
  const path = recipient.contactId
    ? `${documentId}/${recipient.email}/${recipient.contactId}`
    : `${documentId}/${recipient.email}`;
  return `${origin}/login/${toBase64(path)}`;
};

const resolveRequestTemplate = document => {
  const tenant = document?.ExtUserPtr?.TenantId;
  return {
    subject: document?.RequestSubject || tenant?.RequestSubject || '',
    body: document?.RequestBody || tenant?.RequestBody || '',
  };
};

const resolveSender = document => {
  const owner = document.ExtUserPtr;
  const email = document?.SenderMail || owner?.Email;
  const from = document?.SenderName || owner?.UseNameAsSender === true ? owner?.Name : email;
  return { name: document?.SenderName || owner?.Name, email, from };
};

const buildCustomMail = ({ document, recipient, signingUrl, expiryDate, sender }) => {
  const { subject, body } = resolveRequestTemplate(document);
  if (!subject || !body) return undefined;
  const html = HTML_BODY_PREFIX + body.replace(/"/g, "'") + HTML_BODY_SUFFIX;
  const owner = document.ExtUserPtr;
  return renderMailTemplate(subject, html, {
    document_title: document?.Name,
    note: document?.Note || '',
    sender_name: sender.name,
    sender_mail: sender.email,
    sender_phone: owner?.Phone || '',
    receiver_name: recipient.name,
    receiver_email: recipient.email,
    receiver_phone: recipient.phone,
    expiry_date: expiryDate,
    company_name: owner?.Company || '',
    signing_url: signingUrl,
  });
};

const buildDefaultMail = ({ document, signingUrl, expiryDate, sender }) => {
  const values = {
    note: document?.Note || '',
    senderName: sender.name,
    senderMail: sender.email,
    title: document.Name,
    organization: document.ExtUserPtr?.Company || '',
    localExpireDate: expiryDate,
    signingUrl,
  };
  return {
    subject: toMailSubject(mailTemplate(values).subject),
    body: mailTemplate(mapValues(values, escapeHtml)).body,
  };
};

export function buildSignerInvitationMail({ document, placeholder, publicUrl }) {
  const recipient = resolveRecipient(document, placeholder);
  if (!recipient) return null;
  const origin = new URL(publicUrl).origin;
  const sender = resolveSender(document);
  const signingUrl = buildSigningUrl(origin, document.objectId, recipient);
  const context = {
    document,
    recipient,
    signingUrl,
    expiryDate: formatExpiryDate(document),
    sender,
  };
  const mail = buildCustomMail(context) ?? buildDefaultMail(context);
  return {
    extUserId: document.ExtUserPtr?.objectId,
    recipient: recipient.email,
    subject: mail.subject,
    from: sender.from,
    replyto: sender.email || '',
    html: mail.body,
  };
}
