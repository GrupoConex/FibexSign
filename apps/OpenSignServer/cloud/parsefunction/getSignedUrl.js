import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl as presign } from '@aws-sdk/s3-request-presigner';
import { useLocal } from '../../Utils.js';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { isAuthenticated } from '../../utils/AuthUtils.js';
import {
  parseTrustedLocalFileUrl,
  isTrustedS3Url,
  reportUntrustedStorageHost,
} from './shared/storageUrlPolicy.js';
dotenv.config({ quiet: true });

function extractKeyFromUrl(url) {
  // Create a new URL object
  const parsedUrl = new URL(url);
  // Get the pathname of the URL
  const pathname = parsedUrl.pathname; // e.g. /mybucket/path/to/file.pdf (depends on baseUrl style)
  // Extract the filename from the pathname
  const filename = pathname.substring(pathname.lastIndexOf('/') + 1);
  return filename;
}

function makeEndpoint(endpoint) {
  if (!endpoint) return '';

  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return endpoint;
  }

  return `https://${endpoint}`;
}

function makeS3Client() {
  const accessKeyId = process.env.DO_ACCESS_KEY_ID;

  const secretAccessKey = process.env.DO_SECRET_ACCESS_KEY;

  const region = process.env.DO_REGION;

  const endpoint = makeEndpoint(process.env.DO_ENDPOINT);

  return new S3Client({
    region,
    endpoint, // endpoint should be Url e.g. https://blr1.digitaloceanspaces.com)
    credentials: { accessKeyId, secretAccessKey },
  });
}

const PRESIGN_EXPIRES_IN_SECONDS = 160;

async function presignBucketObject(url) {
  const client = makeS3Client();
  const command = new GetObjectCommand({
    Bucket: process.env.DO_SPACE,
    Key: extractKeyFromUrl(url),
  });
  return presign(client, command, { expiresIn: PRESIGN_EXPIRES_IN_SECONDS });
}

export default async function getPresignedUrl(url) {
  if (isTrustedS3Url(url)) {
    return presignBucketObject(url);
  }
  return presignedlocalUrl(url);
}

const presignForCurrentStorage = url =>
  useLocal === 'true' ? presignedlocalUrl(url) : getPresignedUrl(url);

const findDocumentOrTemplate = ({ docId, templateId }) => {
  const query = new Parse.Query(docId ? 'contracts_Document' : 'contracts_Template');
  query.equalTo('objectId', docId || templateId);
  query.include('ExtUserPtr.TenantId');
  query.notEqualTo('IsArchive', true);
  return query.first({ useMasterKey: true });
};

const assertSessionWhenOtpRequired = async (record, user) => {
  if (record.get('IsEnableOTP') && !(await isAuthenticated(user))) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
  }
};

async function signForDocumentOrTemplate(request, url) {
  const { docId = '', templateId = '' } = request.params;
  try {
    const record = await findDocumentOrTemplate({ docId, templateId });
    if (!record) return url;
    await assertSessionWhenOtpRequired(record, request.user);
    return await presignForCurrentStorage(url);
  } catch (err) {
    console.log('Err in presigned url', err);
    throw err;
  }
}

async function signForSession(request, url) {
  if (!(await isAuthenticated(request?.user))) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
  }
  return presignForCurrentStorage(url);
}

export async function getSignedUrl(request) {
  try {
    const { docId, templateId, url } = request.params;
    if (docId || templateId) {
      return await signForDocumentOrTemplate(request, url);
    }
    return await signForSession(request, url);
  } catch (err) {
    console.log('error in getsignedurl', err);
    const code = err.code || 400;
    const msg = err.message;
    const error = new Parse.Error(code, msg);
    throw error;
  }
}

// Function to generate a signed URL with JWT
export function getSignedLocalUrl(fileUrl, expirationTimeInSeconds) {
  const secretKey = process.env.MASTER_KEY;
  const exp = expirationTimeInSeconds || 200;
  try {
    // Create the payload with the file URL and expiration time
    const payload = {
      fileUrl,
      exp: Math.floor(Date.now() / 1000) + exp, // Expiry time in seconds
    };

    // Generate the JWT token
    const token = jwt.sign(payload, secretKey);
    // Return the signed URL containing the token
    return `${fileUrl}?token=${token}`;
  } catch (err) {
    console.log('Err while siging local url', err);
    throw new Error('Invalid or expired token.');
  }
}

export function presignedlocalUrl(signedUrl, expirationTimeInSeconds) {
  const trustedUrl = parseTrustedLocalFileUrl(signedUrl);
  if (!trustedUrl) {
    reportUntrustedStorageHost(signedUrl);
    return signedUrl;
  }
  const fileUrl = trustedUrl.origin + trustedUrl.pathname;
  const exp = expirationTimeInSeconds || 200;
  try {
    const payload = { fileUrl, exp: Math.floor(Date.now() / 1000) + exp };
    const token = jwt.sign(payload, process.env.MASTER_KEY);
    return `${fileUrl}?token=${token}`;
  } catch (err) {
    throw new Error('Invalid or expired token.');
  }
}

// Function to validate the signed URL
export async function validateSignedLocalUrl(signedUrl) {
  const urlParams = new URLSearchParams(signedUrl.split('?')[1]);
  const token = urlParams.get('token');
  try {
    if (!token) {
      throw new Error('No token provided.');
    }
    const secretKey = process.env.MASTER_KEY;
    // Now verify the token (validate signature and expiration automatically)
    const decoded = jwt.verify(token, secretKey);
    // Check if the file URL in the JWT matches the requested file URL
    const fileUrl = signedUrl.split('?')[0];
    if (decoded.fileUrl !== fileUrl) {
      throw new Error('Invalid file URL in token.');
    }
    // If the token is valid and not expired, return the file URL
    return signedUrl;
  } catch (error) {
    console.log('Error validating file', error.message);
    return 'Unauthorized';
  }
}
