import { flattenPdf, getSecureUrl } from '../../Utils.js';
import { parseUploadFile } from '../../utils/fileUtils.js';

const FILE_NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9@._ ~-]*$/;
const DEFAULT_MAX_BYTES = 80 * 1024 * 1024;
const FILE_SIGNATURES = Object.freeze({
  pdf: { mimeType: 'application/pdf', magic: [[0x25, 0x50, 0x44, 0x46, 0x2d]] },
  png: { mimeType: 'image/png', magic: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]] },
  jpg: { mimeType: 'image/jpeg', magic: [[0xff, 0xd8, 0xff]] },
  jpeg: { mimeType: 'image/jpeg', magic: [[0xff, 0xd8, 0xff]] },
});

const unsupportedFile = () =>
  new Parse.Error(Parse.Error.INVALID_FILE_NAME, 'Unsupported file type.');

const resolveMaxBytes = (env = process.env) => {
  const parsed = Number(env.SAVEFILE_MAX_BYTES);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_BYTES;
};

const extensionOf = fileName => fileName.split('.').pop().toLowerCase();

const startsWithSignature = (bytes, signatures) =>
  signatures.some(signature => signature.every((byte, index) => bytes[index] === byte));

const assertFileName = fileName => {
  if (typeof fileName !== 'string' || !FILE_NAME_PATTERN.test(fileName)) {
    throw new Parse.Error(Parse.Error.INVALID_FILE_NAME, 'Invalid file name.');
  }
};

const decodeWithinLimit = fileBase64 => {
  const bytes = Buffer.from(fileBase64, 'base64');
  if (bytes.length > resolveMaxBytes()) {
    throw new Parse.Error(Parse.Error.FILE_TOO_LARGE, 'File is too large.');
  }
  return bytes;
};

const buildUpload = async (fileName, fileBase64) => {
  assertFileName(fileName);
  const signature = FILE_SIGNATURES[extensionOf(fileName)];
  if (!signature) throw unsupportedFile();
  const bytes = decodeWithinLimit(fileBase64);
  if (!startsWithSignature(bytes, signature.magic)) throw unsupportedFile();
  const file = signature.mimeType === 'application/pdf' ? await flattenPdf(fileBase64) : bytes;
  return { mimeType: signature.mimeType, file };
};

const findCallerProfile = user => {
  const extCls = new Parse.Query('contracts_Users');
  extCls.equalTo('UserId', user);
  return extCls.first({ useMasterKey: true });
};

const uploadFile = async (fileName, { file, mimeType }) => {
  try {
    const fileRes = await parseUploadFile(fileName, file, mimeType);
    const fileUrl = getSecureUrl(fileRes?.url)?.url;
    return { url: fileUrl };
  } catch (err) {
    console.log('savefile upload failed: ', err?.message ?? err);
    throw new Parse.Error(Parse.Error.FILE_SAVE_ERROR, 'File upload failed.');
  }
};

export default async function saveFile(request) {
  const { fileBase64, fileName } = request.params;
  if (!fileBase64 || typeof fileBase64 !== 'string') {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Please provide file.');
  }
  try {
    if (!request.user) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
    }
    if (!(await findCallerProfile(request.user))) {
      throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'User not found.');
    }
    return await uploadFile(fileName, await buildUpload(fileName, fileBase64));
  } catch (err) {
    console.log('err in savetoS3', err);
    throw err;
  }
}
