import { setDocumentCount } from '../../utils/CountUtils.js';
import { buildAuthorizedDocument } from './shared/documentDraft.js';

const MASTER = { useMasterKey: true };

export default async function createDocumentFromApp(request) {
  const doc = request.params?.document;
  if (!doc) {
    throw new Parse.Error(Parse.Error.INVALID_JSON, 'Missing document payload.');
  }
  if (!request.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
  }
  try {
    const { document, profile } = await buildAuthorizedDocument({
      userId: request.user.id,
      ip: request?.headers?.['x-real-ip'],
      doc,
    });
    const docRes = await document.save(null, MASTER);
    setDocumentCount(profile.id);
    return docRes;
  } catch (error) {
    console.log('error in create document from app: ', error);
    throw error;
  }
}
