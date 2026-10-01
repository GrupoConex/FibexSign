import { appName, smtpenable, updateMailCount } from '../../Utils.js';
import { issueOtp, normalizeEmail } from './shared/otpPolicy.js';

const RESEND_LIMIT_MESSAGE = 'Too many OTP requests. Please try again later.';
const SEND_FAILURE_MESSAGE = 'Could not send the OTP email. Please try again later.';
const INTERNAL_FAILURE_MESSAGE = 'Could not process the OTP request. Please try again later.';

async function getDocument(docId) {
  try {
    const query = new Parse.Query('contracts_Document');
    query.equalTo('objectId', docId);
    query.include('ExtUserPtr');
    query.include('CreatedBy');
    query.include('Signers');
    query.include('AuditTrail.UserPtr');
    query.include('ExtUserPtr.TenantId');
    query.include('Placeholders');
    query.notEqualTo('IsArchive', true);
    const res = await query.first({ useMasterKey: true });
    const _res = res?.toJSON();
    return _res?.ExtUserPtr?.objectId;
  } catch (err) {
    console.log('err ', err);
  }
}

const buildOtpHtml = code =>
  `<html><head><meta http-equiv='Content-Type' content='text/html;charset=UTF-8' /></head><body><div style='background-color:#f5f5f5;padding:20px'><div style='background-color:white;'><div style='background-color:red;padding:2px;font-family:system-ui;background-color:#47a3ad;'><p style='font-size:20px;font-weight:400;color:white;padding-left:20px;'>OTP Verification</p></div><div style='padding:20px;'><p style='font-family:system-ui;font-size:14px;'>Your OTP for ${appName} verification is:</p><p style='text-decoration:none;font-weight:bolder;color:blue;font-size:45px;margin:20px;'>` +
  code +
  '</p></div></div></div></body></html>';

async function deliverOtp(recipient, code) {
  const mailsender = smtpenable ? process.env.SMTP_USER_EMAIL : process.env.MAILGUN_SENDER;
  try {
    await Parse.Cloud.sendEmail({
      sender: appName + ' <' + mailsender + '>',
      recipient,
      subject: `Your ${appName} OTP`,
      text: 'otp email',
      html: buildOtpHtml(code),
    });
  } catch (err) {
    console.error('error in send OTP mail', err);
    throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, SEND_FAILURE_MESSAGE);
  }
}

async function notifyDocumentOwner(docId) {
  if (!docId) {
    return;
  }
  const extUserId = await getDocument(docId);
  if (extUserId) {
    updateMailCount(extUserId);
  }
}

const toControlledError = err =>
  err instanceof Parse.Error
    ? err
    : new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, INTERNAL_FAILURE_MESSAGE);

async function sendMailOTPv1(request) {
  try {
    const email = normalizeEmail(request.params.email);
    if (!email) {
      return 'Please Enter valid email';
    }
    const issued = await issueOtp({ email, tenantId: request.params.TenantId });
    if (!issued.allowed) {
      throw new Parse.Error(Parse.Error.REQUEST_LIMIT_EXCEEDED, RESEND_LIMIT_MESSAGE);
    }
    await deliverOtp(email, issued.otp);
    await notifyDocumentOwner(request.params.docId);
    return 'Otp send';
  } catch (err) {
    console.error('err in sendMailOTPv1', err);
    throw toControlledError(err);
  }
}
export default sendMailOTPv1;
