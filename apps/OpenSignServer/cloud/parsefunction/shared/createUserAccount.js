import { createAccountAsServer } from './accountTakeoverGuard.js';
import { consumeOtpOrThrow } from './otpPolicy.js';

export { generateGuestPassword } from './guestPassword.js';

const REQUIRED_USER_DETAIL_FIELDS = Object.freeze(['name', 'email', 'password', 'company']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isNonEmptyString = value => typeof value === 'string' && value.trim().length > 0;

const isPlainObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);

function findUserDetailsValidationError(userDetails, allowedRoles) {
  if (!isPlainObject(userDetails)) {
    return 'Please provide user details.';
  }
  const invalidFields = REQUIRED_USER_DETAIL_FIELDS.filter(
    field => !isNonEmptyString(userDetails[field])
  );
  if (invalidFields.length > 0) {
    return `Missing or invalid required fields: ${invalidFields.join(', ')}.`;
  }
  if (!EMAIL_PATTERN.test(userDetails.email.replace(/\s/g, ''))) {
    return 'Invalid email address.';
  }
  if (!allowedRoles.includes(userDetails.role)) {
    return 'Invalid role.';
  }
  return null;
}

export function assertValidUserDetails(userDetails, allowedRoles) {
  const validationError = findUserDetailsValidationError(userDetails, allowedRoles);
  if (validationError) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, validationError);
  }
}

export default async function createUserAccount(userDetails, otp) {
  const normalizedEmail = userDetails.email?.toLowerCase()?.replace(/\s/g, '');
  await consumeOtpOrThrow({ email: normalizedEmail, otp });
  const userQuery = new Parse.Query(Parse.User);
  userQuery.equalTo('username', normalizedEmail);
  const userRes = await userQuery.first({ useMasterKey: true });

  if (userRes) {
    throw new Parse.Error(Parse.Error.USERNAME_TAKEN, 'An account with this email already exists.');
  }

  await createAccountAsServer({
    name: userDetails.name,
    email: normalizedEmail,
    password: userDetails.password,
    phone: userDetails.phone,
    emailVerified: true,
  });
  const loggedInUser = await Parse.User.logIn(normalizedEmail, userDetails.password);
  return { id: loggedInUser.id, sessionToken: loggedInUser.getSessionToken() };
}
