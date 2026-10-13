import axios from 'axios';
import { cloudServerUrl, serverAppId } from '../../Utils.js';
import { loadCallerAccess } from './shared/sendMailv3Authorization.js';
import { buildAccessibleTemplateQuery } from './shared/templateAccess.js';

const INVALID_SESSION_TOKEN = 209;
const MASTER = { useMasterKey: true };

const noAccess = () => ({ error: "template deleted or you don't have access." });

const isUsableId = id => typeof id === 'string' && id.length > 0;

const fetchSessionUserId = async sessionToken => {
  if (!sessionToken) return undefined;
  const userRes = await axios.get(cloudServerUrl + '/users/me', {
    headers: {
      'X-Parse-Application-Id': serverAppId,
      'X-Parse-Session-Token': sessionToken,
    },
  });
  return userRes?.data?.objectId;
};

const withoutTenantSecrets = template => {
  const tenant = template?.ExtUserPtr?.TenantId;
  if (!tenant) return template;
  const { FileAdapters, PfxFile, ...safeTenant } = tenant;
  return { ...template, ExtUserPtr: { ...template.ExtUserPtr, TenantId: safeTenant } };
};

const readAccessibleTemplate = async (userId, templateId) => {
  try {
    const access = await loadCallerAccess(userId);
    const template = await buildAccessibleTemplateQuery({ userId, access, templateId }).first(
      MASTER
    );
    return template ? withoutTenantSecrets(JSON.parse(JSON.stringify(template))) : noAccess();
  } catch (err) {
    console.log('err', err);
    return err;
  }
};

const isInvalidSessionError = err =>
  err?.response?.data?.code === INVALID_SESSION_TOKEN || err?.code === INVALID_SESSION_TOKEN;

export default async function GetTemplate(request) {
  const templateId = request.params.templateId;
  try {
    const userId = await fetchSessionUserId(request.headers?.sessiontoken);
    if (!isUsableId(templateId) || !isUsableId(userId)) return noAccess();
    return await readAccessibleTemplate(userId, templateId);
  } catch (err) {
    console.log('err', err);
    return isInvalidSessionError(err) ? { error: 'Invalid session token' } : noAccess();
  }
}
