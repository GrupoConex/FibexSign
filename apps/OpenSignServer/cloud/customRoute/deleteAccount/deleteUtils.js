import { appName } from '../../../Utils.js';
import sendSystemMail from '../../parsefunction/sendSystemMail.js';
import { OTP_LENGTH, OTP_TTL_MS, buildOtpKey } from '../../parsefunction/shared/otpPolicy.js';

export { OTP_LENGTH };
export const OTP_EXPIRES_MIN = OTP_TTL_MS / 60000;
export const RESEND_COOLDOWN_SEC = 30;

const DELIVERED_STATUS = 'success';

export const DELETE_ACCOUNT_PURPOSE = 'delete-account';

export const deleteOtpKey = email => buildOtpKey({ email, purpose: DELETE_ACCOUNT_PURPOSE });

export const isMailDelivered = delivery => delivery?.status === DELIVERED_STATUS;

export const msUntil = (nowMs, futureMs) => Math.max(0, futureMs - nowMs);

const buildDeleteOtpHtml = otp => `
<html lang="en">
  <body style="margin:0;padding:0;background:#f6f7fb;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7fb;">
      <tr>
        <td align="center" style="padding:24px;">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e9ecf1;border-radius:8px;padding:20px;">
            <tr>
              <td align="left" style="font-size:16px;color:#0f172a;">
                <div style="font-weight:bold;margin-bottom:8px;">${appName}</div>
                <div style="font-size:18px;margin:0 0 12px 0;">Your verification code</div>
                <div style="display:inline-block;border:1px solid #e9ecf1;border-radius:6px;background:#f8fafc;padding:10px 14px;margin-bottom:10px;">
                  <span style="font-family:Consolas,'Courier New',monospace;font-size:24px;letter-spacing:6px;color:#0f172a;">${otp}</span>
                </div>
                <p style="margin:8px 0 0 0;font-size:13px;color:#475569;">
                  This code expires in <strong>${OTP_EXPIRES_MIN}</strong> minutes.
                </p>
                <hr style="border:none;border-top:1px solid #e9ecf1;margin:18px 0;">
                <p style="margin:0;font-size:12px;color:#64748b;">
                  If you didn’t request this code, you can ignore this email.
                </p>
              </td>
            </tr>
          </table>
          <div style="font-size:11px;color:#94a3b8;margin-top:12px;">
            &copy; ${new Date().getFullYear()} ${appName}. All rights reserved.
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

export const sendDeleteOtpEmail = (extUser, otp) =>
  sendSystemMail({
    params: {
      extUserId: extUser.id,
      from: appName,
      recipient: extUser.get('Email'),
      subject: 'OTP for Deletion account request',
      html: buildDeleteOtpHtml(otp),
    },
  });
