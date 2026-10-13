const PROFILE_CLASS = 'contracts_Users';

export const buildActiveProfileQuery = userId =>
  new Parse.Query(PROFILE_CLASS)
    .equalTo('UserId', { __type: 'Pointer', className: '_User', objectId: userId })
    .notEqualTo('IsDisabled', true)
    .doesNotExist('RemovedFromOrgAt');
