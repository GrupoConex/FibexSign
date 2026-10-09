import axios from 'axios';
import { cloudServerUrl, serverAppId } from '../../../Utils.js';
import { findOwnExtUser } from './accountLookup.js';
import { checkDeleteOtp } from './deleteOtpVerification.js';
import { deleteUser } from './deleteUserCascade.js';

const MASTER = { useMasterKey: true };
const ADMIN_ROLE = 'contracts_Admin';
const ORG_ADMIN_ROLE = 'contracts_OrgAdmin';
const GENERIC_FAILURE = 'An error occurred while deleting your account.';
const SELF_DELETE_FORBIDDEN =
  'This action is not permitted. Kindly contact your administrator to request account deletion.';
const TEAM_USERS_REMAIN =
  "To delete this account, start by removing all team users associated with it. Once all users are removed, you'll be able to permanently delete the account.";

const hasTeamMembers = async extUser => {
  const query = new Parse.Query('contracts_Users');
  query.equalTo('TenantId', extUser.get('TenantId'));
  query.notEqualTo('UserRole', ADMIN_ROLE);
  return Boolean(await query.first(MASTER));
};

const selfDeleteBlocker = async extUser => {
  if (!extUser) return 'User not found.';
  if (extUser.get('UserRole') !== ADMIN_ROLE) return SELF_DELETE_FORBIDDEN;
  if (await hasTeamMembers(extUser)) return TEAM_USERS_REMAIN;
  return null;
};

export const deleteUserPost = async (req, res) => {
  const { userId } = req.params;
  try {
    const extUser = await findOwnExtUser(userId);
    const blocker = await selfDeleteBlocker(extUser);
    if (blocker) return res.send(blocker);

    const otpRefusal = await checkDeleteOtp(extUser.get('Email'), req.body?.otp);
    if (otpRefusal) return res.status(otpRefusal.status).send(otpRefusal.message);

    const outcome = await deleteUser(userId);
    return res.status(outcome.code).send(outcome.message);
  } catch (error) {
    console.error('Account deletion error:', error);
    return res.status(500).send(error?.message ?? GENERIC_FAILURE);
  }
};

const fetchSessionUserId = async sessionToken => {
  const response = await axios.get(`${cloudServerUrl}/users/me`, {
    headers: {
      'X-Parse-Application-Id': serverAppId,
      'X-Parse-Session-Token': sessionToken,
    },
  });
  return response.data?.objectId;
};

const describeRequestFailure = error =>
  error?.response?.data?.error ?? error?.message ?? GENERIC_FAILURE;

const buildActor = (adminId, adminExtUser) => {
  const role = adminExtUser.get('UserRole');
  const isOrgAdmin = role === ORG_ADMIN_ROLE;
  return {
    adminId,
    tenantPtr: adminExtUser.get('TenantId'),
    isOrgAdmin,
    orgPtr: isOrgAdmin ? adminExtUser.get('OrganizationId') : undefined,
    isAllowed: isOrgAdmin ? Boolean(adminExtUser.get('OrganizationId')) : role === ADMIN_ROLE,
  };
};

const refuseUnauthorized = res => res.status(400).json({ message: 'Unauthorized.' });

export const deleteUserByAdmin = async (req, res) => {
  const sessionToken = req.headers.sessiontoken;
  const { userId } = req.params;
  if (!sessionToken) return refuseUnauthorized(res);
  if (userId === ':userId') return res.status(400).json({ message: 'Missing userId parameter.' });
  try {
    const adminId = await fetchSessionUserId(sessionToken);
    if (!adminId) return refuseUnauthorized(res);
    if (adminId === userId) {
      return res.status(400).json({ message: 'You cannot delete your own account.' });
    }
    const adminExtUser = await findOwnExtUser(adminId);
    if (!adminExtUser) return res.status(400).json({ message: 'User not found.' });
    const actor = buildActor(adminId, adminExtUser);
    if (!actor.isAllowed) return refuseUnauthorized(res);
    const outcome = await deleteUser(userId, actor);
    return res.status(outcome.code).json({ message: outcome.message });
  } catch (error) {
    const message = describeRequestFailure(error);
    console.error('Account deletion error:', message);
    return res.status(400).json({ message });
  }
};
