const MASTER = { useMasterKey: true };

export const toUserPointer = userId => ({
  __type: 'Pointer',
  className: '_User',
  objectId: userId,
});

export const buildOwnExtUserQuery = userId => {
  const query = new Parse.Query('contracts_Users');
  query.equalTo('UserId', toUserPointer(userId));
  query.notEqualTo('IsLinkedAccount', true);
  return query;
};

export const findOwnExtUser = userId => buildOwnExtUserQuery(userId).first(MASTER);

export const findById = (className, objectId) =>
  new Parse.Query(className).equalTo('objectId', objectId).first(MASTER);
