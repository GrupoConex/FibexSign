import axios from 'axios';
import { cloudServerUrl, serverAppId } from '../../Utils.js';
import { OtpStatus, normalizeEmail, verifyAndConsumeOtp } from './shared/otpPolicy.js';

const GENERIC_INVALID_OTP_MESSAGE = 'Invalid Otp';
const USER_NOT_FOUND_MESSAGE = 'user not found!';

const buildUserNotFoundError = () =>
  new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, USER_NOT_FOUND_MESSAGE);

async function requestLoginAs(userId) {
  try {
    const response = await axios({
      method: 'POST',
      url: `${cloudServerUrl}/loginAs`,
      headers: {
        'Content-Type': 'application/json;charset=utf-8',
        'X-Parse-Application-Id': serverAppId,
        'X-Parse-Master-Key': process.env.MASTER_KEY,
      },
      params: { userId },
    });
    return response.data;
  } catch {
    return undefined;
  }
}

async function fetchSession(email) {
  const userQuery = new Parse.Query(Parse.User);
  userQuery.equalTo('email', email);
  const user = await userQuery.first({ useMasterKey: true });
  const session = user && (await requestLoginAs(user.id));
  if (!session) {
    throw buildUserNotFoundError();
  }
  return session;
}

async function markEmailVerified(session) {
  const userQuery = new Parse.Query(Parse.User);
  const user = await userQuery.get(session.objectId, { sessionToken: session.sessionToken });
  user.set('emailVerified', true);
  return user.save(null, { useMasterKey: true });
}

async function AuthLoginAsMail(request) {
  try {
    const email = normalizeEmail(request.params.email);
    const status = await verifyAndConsumeOtp({ email, otp: request.params.otp });
    if (status === OtpStatus.NOT_FOUND) {
      return USER_NOT_FOUND_MESSAGE;
    }
    if (status !== OtpStatus.VALID) {
      return GENERIC_INVALID_OTP_MESSAGE;
    }
    const session = await fetchSession(email);
    if (session.emailVerified) {
      return session;
    }
    const verifiedUser = await markEmailVerified(session);
    if (verifiedUser) {
      return session;
    }
    throw buildUserNotFoundError();
  } catch (err) {
    console.log('err in Auth');
    console.log(err);
    return 'Result not found';
  }
}
export default AuthLoginAsMail;
