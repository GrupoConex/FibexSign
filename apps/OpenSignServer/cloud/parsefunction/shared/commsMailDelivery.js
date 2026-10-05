import { updateMailCount } from '../../../Utils.js';
import { CommsMailError, sendCommsMail } from './commsMailClient.js';

const describeFailure = err => (err instanceof CommsMailError ? err.message : 'unexpected_error');

export const deliverViaComms = async (
  message,
  { extUserId, label, sendMail = sendCommsMail, countMail = updateMailCount }
) => {
  try {
    await sendMail(message);
    if (extUserId) await countMail(extUserId);
    return { status: 'success' };
  } catch (err) {
    console.log(`${label} Error: ${describeFailure(err)}`);
    return { status: 'error' };
  }
};

export const toCommsMessage = params => ({
  to: params.recipient,
  cc: params.cc,
  bcc: params.bcc,
  subject: params.subject,
  text: params.text || 'mail',
  html: params.html,
});
