export default async function createUserAccount(userDetails) {
  const normalizedEmail = userDetails.email?.toLowerCase()?.replace(/\s/g, '');
  const userQuery = new Parse.Query(Parse.User);
  userQuery.equalTo('username', normalizedEmail);
  const userRes = await userQuery.first({ useMasterKey: true });

  if (userRes) {
    throw new Parse.Error(Parse.Error.USERNAME_TAKEN, 'An account with this email already exists.');
  }

  const user = new Parse.User();
  user.set('username', normalizedEmail);
  user.set('password', userDetails.password);
  user.set('email', normalizedEmail);
  user.set('normalizedEmail', normalizedEmail);
  if (userDetails?.phone) {
    user.set('phone', userDetails.phone);
  }
  user.set('name', userDetails.name);

  await user.signUp();
  const loggedInUser = await Parse.User.logIn(normalizedEmail, userDetails.password);
  return { id: loggedInUser.id, sessionToken: loggedInUser.getSessionToken() };
}
