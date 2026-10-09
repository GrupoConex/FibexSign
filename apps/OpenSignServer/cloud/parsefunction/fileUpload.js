import { getSignedLocalUrl } from './getSignedUrl.js';
import { parseTrustedLocalFileUrl } from './shared/storageUrlPolicy.js';

export default async function fileUpload(request) {
  const url = request.params.url;

  if (!request.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
  }
  const trustedUrl = parseTrustedLocalFileUrl(url);
  if (!trustedUrl) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Invalid url.');
  }

  try {
    const urlwithjwt = getSignedLocalUrl(trustedUrl.origin + trustedUrl.pathname, 200);
    return { url: urlwithjwt };
  } catch (err) {
    console.log('Err ', err);
    throw err;
  }
}
