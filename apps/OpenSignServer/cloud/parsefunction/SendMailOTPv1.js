import { randomInt } from 'node:crypto';
import { appName, smtpenable, updateMailCount } from '../../Utils.js';

const OTP_EXPIRY_MS = 10 * 60 * 1000;

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
async function sendMailOTPv1(request) {
  try {
    let code = randomInt(1000, 10000);
    let email = request.params.email;
    let TenantId = request.params.TenantId ? request.params.TenantId : undefined;
    const AppName = appName;

    if (email) {
      const recipient = request.params.email;
      const mailsender = smtpenable ? process.env.SMTP_USER_EMAIL : process.env.MAILGUN_SENDER;
      try {
        await Parse.Cloud.sendEmail({
          sender: AppName + ' <' + mailsender + '>',
          recipient: recipient,
          subject: `Your ${AppName} OTP`,
          text: 'otp email',
          html:
            `<html><head><meta http-equiv='Content-Type' content='text/html;charset=UTF-8' /></head><body><div style='background-color:#f5f5f5;padding:20px'><div style='background-color:white;'><div style='background-color:red;padding:2px;font-family:system-ui;background-color:#47a3ad;'><p style='font-size:20px;font-weight:400;color:white;padding-left:20px;'>OTP Verification</p></div><div style='padding:20px;'><p style='font-family:system-ui;font-size:14px;'>Your OTP for ${AppName} verification is:</p><p style='text-decoration:none;font-weight:bolder;color:blue;font-size:45px;margin:20px;'>` +
            code +
            '</p></div></div></div></body></html>',
        });
        console.log('OTP sent for', email);
        if (request.params?.docId) {
          const extUserId = await getDocument(request.params?.docId);
          if (extUserId) {
            updateMailCount(extUserId);
          }
        }
      } catch (err) {
        console.log('error in send OTP mail', err);
      }
      const tempOtp = new Parse.Query('defaultdata_Otp');
      tempOtp.equalTo('Email', email);
      const resultOTP = await tempOtp.first({ useMasterKey: true });
      const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);
      if (resultOTP !== undefined) {
        const updateOtpQuery = new Parse.Query('defaultdata_Otp');
        const updateOtp = await updateOtpQuery.get(resultOTP.id, {
          useMasterKey: true,
        });
        updateOtp.set('OTP', code);
        updateOtp.set('ExpiresAt', expiresAt);
        updateOtp.set('FailedAttempts', 0);
        await updateOtp.save(null, { useMasterKey: true });
      } else {
        const otpClass = Parse.Object.extend('defaultdata_Otp');
        const newOtpQuery = new otpClass();
        newOtpQuery.set('OTP', code);
        newOtpQuery.set('Email', email);
        newOtpQuery.set('TenantId', TenantId);
        newOtpQuery.set('ExpiresAt', expiresAt);
        newOtpQuery.set('FailedAttempts', 0);
        await newOtpQuery.save(null, { useMasterKey: true });
      }
      return 'Otp send';
    } else {
      return 'Please Enter valid email';
    }
  } catch (err) {
    console.log('err in sendMailOTPv1');
    console.log(err);
    return err;
  }
}
export default sendMailOTPv1;
