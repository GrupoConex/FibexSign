import { buildActiveProfileQuery } from './shared/activeProfileQuery.js';

const MASTER = { useMasterKey: true };
const MAIL_KEYS = Object.freeze([
  'CompletionBody',
  'CompletionSubject',
  'RequestBody',
  'RequestSubject',
]);
const RESPONSE_KEYS = Object.freeze([...MAIL_KEYS, 'EmailEditorType']);

const applyMailDetails = (profile, details) => {
  Object.keys(details)
    .filter(key => MAIL_KEYS.includes(key))
    .forEach(key => (details[key] ? profile.set(key, details[key]) : profile.unset(key)));
  if (details.EmailEditorType) profile.set('EmailEditorType', details.EmailEditorType);
  return profile;
};

const toTemplateResponse = profile => ({
  objectId: profile.id,
  updatedAt: profile.updatedAt?.toISOString(),
  ...Object.fromEntries(RESPONSE_KEYS.map(key => [key, profile.get(key)])),
});

export default async function updateEmailTemplates(request) {
  const { tenantId, details } = request.params;

  if (!tenantId || !details) {
    throw new Parse.Error(400, 'Missing tenantId or details.');
  }

  if (!request.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'unauthorized');
  }

  try {
    const profile = await buildActiveProfileQuery(request.user.id).first(MASTER);
    if (!profile) {
      throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'User not found.');
    }
    const saved = await applyMailDetails(profile, details).save(null, MASTER);
    return toTemplateResponse(saved);
  } catch (error) {
    console.log('error while updating email templates:', error);
    throw error;
  }
}
