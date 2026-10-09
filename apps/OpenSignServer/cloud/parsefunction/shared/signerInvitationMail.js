import { mailTemplate, replaceMailVaribles } from '../../../Utils.js';

const DEFAULT_COMPLETION_DAYS = 15;
const HTML_BODY_PREFIX =
  "<html><head><meta http-equiv='Content-Type' content='text/html; charset=UTF-8' /></head><body>";
const HTML_BODY_SUFFIX = '</body></html>';

const toBase64 = value => Buffer.from(value, 'utf8').toString('base64');

export const getPlaceholderRole = placeholder =>
  placeholder?.SignerRole || placeholder?.signer_role || placeholder?.role || 'signer';

const formatExpiryDate = document => {
  const expiry = new Date(document.createdAt);
  expiry.setDate(expiry.getDate() + (document?.TimeToCompleteDays || DEFAULT_COMPLETION_DAYS));
  return expiry.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
};

const resolveRecipient = (document, placeholder) => {
  const contactId = placeholder?.signerObjId;
  const contact = contactId
    ? document?.Signers?.find(signer => signer.objectId === contactId)
    : undefined;
  return {
    contactId,
    email: contact?.Email || placeholder?.email,
    name: contact?.Name || '',
    phone: contact?.Phone || '',
  };
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
  const email = document?.SenderMail || owner.Email;
  const from = document?.SenderName || owner?.UseNameAsSender === true ? owner.Name : email;
  return { name: document?.SenderName || owner.Name, email, from };
};

const buildCustomMail = ({ document, recipient, signingUrl, expiryDate, sender }) => {
  const { subject, body } = resolveRequestTemplate(document);
  if (!subject || !body) return undefined;
  const html = HTML_BODY_PREFIX + body.replace(/"/g, "'") + HTML_BODY_SUFFIX;
  const owner = document.ExtUserPtr;
  return replaceMailVaribles(subject, html, {
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

export function buildSignerInvitationMail({ document, placeholder, publicUrl }) {
  const origin = new URL(publicUrl).origin;
  const recipient = resolveRecipient(document, placeholder);
  const sender = resolveSender(document);
  const signingUrl = buildSigningUrl(origin, document.objectId, recipient);
  const expiryDate = formatExpiryDate(document);
  const custom = buildCustomMail({ document, recipient, signingUrl, expiryDate, sender });
  const fallback = mailTemplate({
    note: document?.Note || '',
    senderName: sender.name,
    senderMail: sender.email,
    title: document.Name,
    organization: document.ExtUserPtr.Company || '',
    localExpireDate: expiryDate,
    signingUrl,
  });
  return {
    extUserId: document.ExtUserPtr.objectId,
    recipient: recipient.email,
    subject: custom?.subject || fallback.subject,
    from: sender.from,
    replyto: sender.email || '',
    html: custom?.body || fallback.body,
  };
}
