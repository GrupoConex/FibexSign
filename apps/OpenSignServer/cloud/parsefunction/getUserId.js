async function getUserId(request) {
  const username = request.params.username;
  const email = request.params.email;
  const query = new Parse.Query(Parse.User);
  if (username) {
    query.equalTo('username', username);
  } else {
    query.equalTo('email', email);
  }
  const user = await query.first({ useMasterKey: true });
  if (!user) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'User not found.');
  }
  return { id: user.id };
}
export default getUserId;
