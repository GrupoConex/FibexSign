import { persistSignature, pickProvidedFields } from './shared/signatureRecord.js';

export default async function saveSignature(request) {
  return persistSignature(request, pickProvidedFields(request.params));
}
