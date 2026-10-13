import {
  buildOwnExtUserQuery,
  toUserPointer,
} from '../../customRoute/deleteAccount/accountLookup.js';

const PROFILE_CLASS = 'contracts_Users';
const MASTER = { useMasterKey: true };

const isUsableId = id => typeof id === 'string' && id.length > 0;

const findRequestedProfile = async (userId, requestedExtUserId) => {
  if (!isUsableId(requestedExtUserId)) return undefined;
  return new Parse.Query(PROFILE_CLASS)
    .equalTo('objectId', requestedExtUserId)
    .equalTo('UserId', toUserPointer(userId))
    .notEqualTo('IsDisabled', true)
    .first(MASTER);
};

const findEnabledOwnProfile = userId =>
  buildOwnExtUserQuery(userId).notEqualTo('IsDisabled', true).first(MASTER);

export const resolveCallerProfile = async (userId, requestedExtUserId) => {
  const profile =
    (await findRequestedProfile(userId, requestedExtUserId)) ??
    (await findEnabledOwnProfile(userId));
  if (!profile) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Caller has no user profile');
  }
  return profile;
};
