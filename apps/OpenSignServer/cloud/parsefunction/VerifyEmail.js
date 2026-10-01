import { revokeUntrustedSessions, unlinkAuthProviders } from './shared/accountTakeoverGuard.js';
import { OtpStatus, normalizeEmail, verifyAndConsumeOtp } from './shared/otpPolicy.js';

const INVALID_OTP_MESSAGE = 'OTP is invalid.';
const BAD_REQUEST_CODE = 400;

function buildBadRequestError(message) {
  const error = new Error(message);
  error.code = BAD_REQUEST_CODE;
  return error;
}

async function markEmailVerified(currentUser) {
  const userQuery = new Parse.Query(Parse.User);
  const user = await userQuery.get(currentUser.id, { useMasterKey: true });
  user.set('emailVerified', true);
  unlinkAuthProviders(user);
  return user.save(null, { useMasterKey: true });
}

async function assertOtpBelongsToCaller(request) {
  const email = normalizeEmail(request.params.email);
  if (!email || email !== normalizeEmail(request.user.get('email'))) {
    throw buildBadRequestError(INVALID_OTP_MESSAGE);
  }
  const status = await verifyAndConsumeOtp({ email, otp: request.params.otp });
  if (status !== OtpStatus.VALID) {
    throw buildBadRequestError(INVALID_OTP_MESSAGE);
  }
}

export default async function VerifyEmail(request) {
  try {
    if (!request?.user) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
    }
    await assertOtpBelongsToCaller(request);
    if (request.user.get('emailVerified')) {
      return { message: 'Email is already verified.' };
    }
    if (await markEmailVerified(request.user)) {
      await revokeUntrustedSessions(request.user.id, request.user.getSessionToken());
      return { message: 'Email is verified.' };
    }
    throw buildBadRequestError('Something went wrong, please try again later!');
  } catch (err) {
    console.log('err ', err.code + ' ' + err.message);
    throw err;
  }
}
