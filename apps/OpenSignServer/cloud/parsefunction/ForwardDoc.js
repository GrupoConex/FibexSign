import { appName } from '../../Utils.js';
import sendMailWithAttachment from './sendMailWithAttachment.js';
import {
  buildForwardMail,
  normalizeRecipients,
  resolveSender,
  summarizeDeliveries,
} from './shared/forwardDocMail.js';

const deliver = async mail => {
  try {
    const result = await sendMailWithAttachment(mail);
    return { recipient: mail.recipient, isSent: result?.status === 'success' };
  } catch (error) {
    return { recipient: mail.recipient, isSent: false, error };
  }
};

const deliverInOrder = async mails => {
  const outcomes = [];
  for (const mail of mails) {
    outcomes.push(await deliver(mail));
  }
  return outcomes;
};

const findOwnDocument = async (docId, userId) => {
  const userPtr = { __type: 'Pointer', className: '_User', objectId: userId };
  const docQuery = new Parse.Query('contracts_Document');
  docQuery
    .equalTo('objectId', docId)
    .equalTo('CreatedBy', userPtr)
    .notEqualTo('IsArchive', true)
    .notEqualTo('IsDeclined', true)
    .include('Signers')
    .include('ExtUserPtr')
    .include('Placeholders.signerPtr')
    .include('ExtUserPtr.TenantId');
  const docRes = await docQuery.first({ useMasterKey: true });
  if (!docRes) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Document not found.');
  }
  return docRes.toJSON();
};

export default async function forwardDoc(request) {
  try {
    if (!request.user) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'unauthorized.');
    }
    const { docId } = request.params;
    if (!docId) {
      throw new Parse.Error(Parse.Error.INVALID_QUERY, 'please provide parameters.');
    }
    const recipients = normalizeRecipients(request.params.recipients);
    const document = await findOwnDocument(docId, request.user.id);
    const sender = resolveSender(document, request.user, appName);
    const mails = recipients.map(recipient =>
      buildForwardMail({
        ...sender,
        recipient,
        extUserId: document?.ExtUserPtr?.objectId,
        docName: document.Name,
        url: document?.SignedUrl || '',
      })
    );
    return summarizeDeliveries(await deliverInOrder(mails));
  } catch (err) {
    console.log('Err in forwardDoc', err);
    throw err;
  }
}
