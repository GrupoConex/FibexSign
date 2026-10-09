import { mkdir } from 'node:fs/promises';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  createS3Client,
  deleteContactsInBatch,
  deleteDataFiles,
  deleteFileByUrl,
  deleteInBatches,
} from '../../../cloud/customRoute/deleteAccount/deleteFileUrl.js';
import {
  countWhere,
  createDeletableAdmin,
  createLocalFile,
  localFileExists,
  localFileUrl,
  removeLocalFile,
  saveRows,
  uniqueFileName,
} from '../../utils/delete-account-fixtures.js';
import { knownDefect } from '../../utils/known-defect.js';
import { pointer, silenceConsole } from '../../utils/auth-fixtures.js';

const REMOTE_URL = 'https://bucket-one.nyc3.digitaloceanspaces.com/folder%20a/report.pdf';
const FULL_BATCH = 500;

describe('stored file removal', () => {
  let cleanupPaths;

  beforeEach(() => {
    silenceConsole();
    spyOn(console, 'warn');
    spyOn(console, 'error');
    cleanupPaths = [];
  });

  afterEach(async () => {
    await Promise.all(cleanupPaths.map(removeLocalFile));
  });

  const prepareLocalFile = async () => {
    const fileName = uniqueFileName('local');
    const path = await createLocalFile(fileName);
    cleanupPaths.push(path);
    return { fileName, path };
  };

  it('removes a file stored on this server', async () => {
    const { fileName, path } = await prepareLocalFile();

    await deleteFileByUrl(localFileUrl(fileName));

    expect(await localFileExists(path)).toBeFalse();
  });

  it('tolerates a local file that is already gone', async () => {
    await deleteFileByUrl(localFileUrl(uniqueFileName('missing')));

    expect(console.warn).toHaveBeenCalledWith('Local file not found:', jasmine.any(String));
  });

  it('ignores local urls that do not point into the files area', async () => {
    const { fileName, path } = await prepareLocalFile();

    await deleteFileByUrl(`http://localhost:30001/other/${fileName}`);

    expect(await localFileExists(path)).toBeTrue();
  });

  it('reports a local file that cannot be removed', async () => {
    const directoryName = uniqueFileName('directory');
    await mkdir(`./files/files/${directoryName}`, { recursive: true });
    cleanupPaths.push(`./files/files/${directoryName}`);

    await deleteFileByUrl(localFileUrl(directoryName));

    expect(console.error).toHaveBeenCalledWith('Local delete failed:', jasmine.any(String));
  });

  it('survives a url with a malformed escape sequence', async () => {
    await expectAsync(deleteFileByUrl('http://localhost:30001/files/%E0%A4%A')).toBeResolved();

    expect(console.error).toHaveBeenCalled();
  });

  it('skips values that are not urls', async () => {
    await deleteFileByUrl('not a url');

    expect(console.warn).toHaveBeenCalledWith('Invalid URL, skipping:', 'not a url');
  });

  it('asks the object store to delete remote files by bucket and key', async () => {
    const send = spyOn(S3Client.prototype, 'send').and.resolveTo({});

    await deleteFileByUrl(REMOTE_URL);

    const command = send.calls.mostRecent().args[0];
    expect(command instanceof DeleteObjectCommand).toBeTrue();
    expect(command.input).toEqual({ Bucket: 'bucket-one', Key: 'folder a/report.pdf' });
  });

  it('reports an object store failure without throwing', async () => {
    spyOn(S3Client.prototype, 'send').and.rejectWith(new Error('denied'));

    await expectAsync(deleteFileByUrl(REMOTE_URL)).toBeResolved();

    expect(console.error).toHaveBeenCalledWith(`S3 delete failed: ${REMOTE_URL}:`, 'denied');
  });

  it('survives a remote url with a malformed escape sequence', async () => {
    const send = spyOn(S3Client.prototype, 'send').and.resolveTo({});

    await deleteFileByUrl('https://bucket-one.nyc3.digitaloceanspaces.com/%E0%A4%A');

    expect(send).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  [
    ['a custom endpoint', 'nyc3.digitaloceanspaces.com', 'nyc3.digitaloceanspaces.com'],
    ['an aws endpoint', 's3.amazonaws.com', undefined],
    ['no endpoint', null, undefined],
  ].forEach(([description, endpoint, expectedHost]) => {
    it(`builds the object store client for ${description}`, async () => {
      const client = createS3Client({
        region: 'us-east-1',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        endpoint,
      });

      const resolved = await client.config.endpoint?.();

      expect(resolved?.hostname).toBe(expectedHost);
    });
  });
});

describe('batched owner purge', () => {
  beforeEach(() => {
    silenceConsole();
    spyOn(console, 'warn');
    spyOn(console, 'error');
  });

  it('removes owned documents together with their stored files', async () => {
    const admin = await createDeletableAdmin();
    const first = uniqueFileName('doc-url');
    const second = uniqueFileName('doc-signed');
    const paths = [await createLocalFile(first), await createLocalFile(second)];
    const userPtr = pointer('_User', admin.account.id);
    await saveRows('contracts_Document', [
      {
        Name: 'Doc',
        CreatedBy: userPtr,
        URL: localFileUrl(first),
        SignedUrl: localFileUrl(second),
      },
      { Name: 'Doc without files', CreatedBy: userPtr },
    ]);

    await deleteInBatches('contracts_Document', userPtr);

    expect(await countWhere('contracts_Document', 'CreatedBy', userPtr)).toBe(0);
    expect(await localFileExists(paths[0])).toBeFalse();
    expect(await localFileExists(paths[1])).toBeFalse();
    await Promise.all(paths.map(removeLocalFile));
  });

  it('removes data file rows together with their stored file', async () => {
    const admin = await createDeletableAdmin();
    const fileName = uniqueFileName('data');
    const path = await createLocalFile(fileName);
    const userPtr = pointer('_User', admin.account.id);
    await saveRows('partners_DataFiles', [{ UserId: userPtr, FileUrl: localFileUrl(fileName) }]);

    await deleteDataFiles('partners_DataFiles', userPtr);

    expect(await countWhere('partners_DataFiles', 'UserId', userPtr)).toBe(0);
    expect(await localFileExists(path)).toBeFalse();
    await removeLocalFile(path);
  });

  it('keeps going until every page of contacts is removed', async () => {
    const admin = await createDeletableAdmin();
    const userPtr = pointer('_User', admin.account.id);
    await saveRows(
      'contracts_Contactbook',
      Array.from({ length: FULL_BATCH + 1 }, (_, index) => ({
        Name: `Contact ${index}`,
        CreatedBy: userPtr,
      }))
    );

    await deleteContactsInBatch('contracts_Contactbook', userPtr);

    expect(await countWhere('contracts_Contactbook', 'CreatedBy', userPtr)).toBe(0);
  });

  it('does nothing for an owner without rows', async () => {
    await expectAsync(
      deleteContactsInBatch('contracts_Contactbook', pointer('_User', 'nobody0001'))
    ).toBeResolved();
  });

  it(
    'KNOWN DEFECT DEF-L2-03 only removes files the deleted owner actually stored',
    knownDefect(
      'DEF-L2-03',
      'document URL fields are client writable, so deleting an account deletes any file they reference',
      async check => {
        const attacker = await createDeletableAdmin();
        const victimFileName = uniqueFileName('victim');
        const victimPath = await createLocalFile(victimFileName);
        const attackerPtr = pointer('_User', attacker.account.id);
        await saveRows('contracts_Document', [
          { Name: 'Crafted', CreatedBy: attackerPtr, URL: localFileUrl(victimFileName) },
        ]);

        await deleteInBatches('contracts_Document', attackerPtr);

        check(await localFileExists(victimPath), 'file referenced by another owner survives');
        await removeLocalFile(victimPath);
      }
    )
  );
});
