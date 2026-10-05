import crypto from 'node:crypto';
import { consumeOtpOrThrow, normalizeEmail } from './shared/otpPolicy.js';

const INVALID_CREDENTIALS_OR_OTP_MESSAGE = 'Invalid credentials or OTP.';
export default async function loginUser(request) {
  const username = request.params.email;
  const password = request.params.password;

  if (username && password) {
    try {
      // Pass the username and password to logIn function
      const user = await Parse.User.logIn(username, password);
      // console.log('user ', user);
      if (user) {
        const _user = user?.toJSON();
        return {
          ..._user,
        };
      } else {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'user not found.');
      }
    } catch (err) {
      console.log('err in login user', err);
      throw err;
    }
  } else {
    throw new Parse.Error(Parse.Error.PASSWORD_MISSING, 'username/password is missing.');
  }
}

const buildInvalidCredentialsError = () =>
  new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, INVALID_CREDENTIALS_OR_OTP_MESSAGE);

const isNonEmptyString = value => typeof value === 'string' && value.length > 0;

async function verifyPasswordOrThrow(email, password) {
  if (!isNonEmptyString(email) || !isNonEmptyString(password)) {
    throw buildInvalidCredentialsError();
  }
  try {
    return await Parse.User.verifyPassword(email, password);
  } catch {
    throw buildInvalidCredentialsError();
  }
}

function assertTypedEmailIsAccountEmail(account, typedEmail) {
  if (normalizeEmail(account.email) !== normalizeEmail(typedEmail)) {
    throw buildInvalidCredentialsError();
  }
}

async function markEmailVerified(userId) {
  const user = await new Parse.Query(Parse.User).get(userId, { useMasterKey: true });
  user.set('emailVerified', true);
  return user.save(null, { useMasterKey: true });
}

export async function verifyLoginOtp(request) {
  const { email, password, otp } = request.params;
  const account = await verifyPasswordOrThrow(email, password);
  assertTypedEmailIsAccountEmail(account, email);
  await consumeOtpOrThrow({ email: normalizeEmail(email), otp }, buildInvalidCredentialsError);
  await markEmailVerified(account.objectId);
  return loginUser({ params: { email, password } });
}
