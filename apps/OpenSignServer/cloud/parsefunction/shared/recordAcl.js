const isUsableUserId = userId => typeof userId === 'string' && userId.length > 0;

const uniqueUserIds = userIds => [...new Set((userIds ?? []).filter(isUsableUserId))];

export const buildPrivateAcl = userIds =>
  uniqueUserIds(userIds).reduce((acl, userId) => {
    acl.setReadAccess(userId, true);
    acl.setWriteAccess(userId, true);
    return acl;
  }, new Parse.ACL());
