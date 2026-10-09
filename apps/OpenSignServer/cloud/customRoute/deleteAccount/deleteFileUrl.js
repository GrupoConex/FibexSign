import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import fs from 'node:fs/promises';
import pLimit from 'p-limit';
import { serverAppId } from '../../../Utils.js';

const MASTER = { useMasterKey: true };
const serverHost = new URL(process.env.SERVER_URL).hostname;
const LOCAL_HOSTS = ['localhost', '127.0.0.1', serverHost];
const CONCURRENCY_LIMIT = 5;
const BATCH_SIZE = 500;
const LOCAL_FILES_ROOT = './files/files';
const DOCUMENT_FILE_FIELDS = ['URL', 'SignedUrl', 'certificateUrl'];
const DATA_FILE_FIELDS = ['FileUrl'];
const AWS_HOST_MARKER = 'amazonaws.com';

export function createS3Client({ region, accessKeyId, secretAccessKey, endpoint = null }) {
  const config = { region, credentials: { accessKeyId, secretAccessKey } };
  if (endpoint && !endpoint.includes(AWS_HOST_MARKER)) {
    config.endpoint = `https://${endpoint}`;
  }
  return new S3Client(config);
}

const s3 = createS3Client({
  region: process.env.DO_REGION,
  endpoint: process.env.DO_ENDPOINT,
  accessKeyId: process.env.DO_ACCESS_KEY_ID,
  secretAccessKey: process.env.DO_SECRET_ACCESS_KEY,
});

const parseS3Location = fileUrl => {
  const url = new URL(fileUrl);
  return { Bucket: url.hostname.split('.')[0], Key: decodeURIComponent(url.pathname.slice(1)) };
};

async function deleteS3File(fileUrl) {
  try {
    await s3.send(new DeleteObjectCommand(parseS3Location(fileUrl)));
  } catch (err) {
    console.error(`S3 delete failed: ${fileUrl}:`, err.message);
  }
}

async function deleteLocalFile(fileUrl) {
  try {
    const { pathname } = new URL(fileUrl);
    if (!decodeURIComponent(pathname).includes('/files/')) return;
    const relativePath = pathname.split(`/files/${serverAppId}/`).pop();
    await fs.unlink(`${LOCAL_FILES_ROOT}/${relativePath}`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn('Local file not found:', fileUrl);
    } else {
      console.error('Local delete failed:', err.message);
    }
  }
}

export async function deleteFileByUrl(fileUrl) {
  let hostname;
  try {
    hostname = new URL(fileUrl).hostname;
  } catch {
    console.warn('Invalid URL, skipping:', fileUrl);
    return;
  }
  if (LOCAL_HOSTS.includes(hostname)) {
    await deleteLocalFile(fileUrl);
  } else {
    await deleteS3File(fileUrl);
  }
}

const collectFileUrls = (objects, fileFields) =>
  objects.flatMap(object => fileFields.map(field => object.get(field)).filter(Boolean));

const deleteFilesConcurrently = async fileUrls => {
  const limiter = pLimit(CONCURRENCY_LIMIT);
  await Promise.all(fileUrls.map(fileUrl => limiter(() => deleteFileByUrl(fileUrl))));
};

const findBatch = ({ className, ownerField, ownerPointer }) => {
  const query = new Parse.Query(className);
  query.equalTo(ownerField, ownerPointer);
  query.limit(BATCH_SIZE);
  query.ascending('objectId');
  return query.find(MASTER);
};

async function purgeInBatches(source) {
  let batch = await findBatch(source);
  while (batch.length > 0) {
    await deleteFilesConcurrently(collectFileUrls(batch, source.fileFields));
    await Parse.Object.destroyAll(batch, MASTER);
    batch = await findBatch(source);
  }
}

export const deleteInBatches = (className, userPointer) =>
  purgeInBatches({
    className,
    ownerField: 'CreatedBy',
    ownerPointer: userPointer,
    fileFields: DOCUMENT_FILE_FIELDS,
  });

export const deleteDataFiles = (className, userPointer) =>
  purgeInBatches({
    className,
    ownerField: 'UserId',
    ownerPointer: userPointer,
    fileFields: DATA_FILE_FIELDS,
  });

export const deleteContactsInBatch = (className, userPointer) =>
  purgeInBatches({
    className,
    ownerField: 'CreatedBy',
    ownerPointer: userPointer,
    fileFields: [],
  });
