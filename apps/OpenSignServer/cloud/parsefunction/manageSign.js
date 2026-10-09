import { persistSignature, pickAllFields } from './shared/signatureRecord.js';

export default async function manageSign(request) {
  return persistSignature(request, pickAllFields(request.params));
}
