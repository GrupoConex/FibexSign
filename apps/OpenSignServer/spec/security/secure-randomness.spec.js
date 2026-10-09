import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateId } from '../../Utils.js';

const SERVER_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCANNED_ROOTS = ['cloud', 'utils', 'databases', 'migrationdb', 'scripts'];
const SCANNED_FILES = ['Utils.js', 'index.js'];
const SOURCE_FILE = /\.(js|mjs|cjs)$/;
const TEST_FILE = /\.spec\.js$/;
const INSECURE_RANDOMNESS = /Math\.random\s*\(/;
const GENERATED_ID_ALPHABET = /^[a-z0-9]+$/;
const GENERATED_ID_SAMPLE_SIZE = 2000;

const listSourceFiles = directory =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(fullPath);
    return SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name) ? [fullPath] : [];
  });

const collectServerSources = () => [
  ...SCANNED_ROOTS.flatMap(root => listSourceFiles(path.join(SERVER_ROOT, root))),
  ...SCANNED_FILES.map(file => path.join(SERVER_ROOT, file)),
];

const filesUsingInsecureRandomness = () =>
  collectServerSources()
    .filter(file => INSECURE_RANDOMNESS.test(fs.readFileSync(file, 'utf8')))
    .map(file => path.relative(SERVER_ROOT, file).replaceAll('\\', '/'))
    .sort();

describe('server randomness', () => {
  it('never draws identifiers, tokens, passwords or temp names from Math.random', () => {
    expect(filesUsingInsecureRandomness()).toEqual([]);
  });

  describe('generateId', () => {
    it('returns the requested number of lowercase alphanumeric characters', () => {
      const id = generateId(16);

      expect(id.length).toBe(16);
      expect(id).toMatch(GENERATED_ID_ALPHABET);
    });

    it('returns an empty string for a zero length', () => {
      expect(generateId(0)).toBe('');
    });

    it('does not depend on Math.random', () => {
      spyOn(Math, 'random').and.returnValue(0);

      expect(generateId(16)).not.toBe('a'.repeat(16));
    });

    it('does not repeat across many draws', () => {
      const ids = new Set(Array.from({ length: GENERATED_ID_SAMPLE_SIZE }, () => generateId(16)));

      expect(ids.size).toBe(GENERATED_ID_SAMPLE_SIZE);
    });
  });
});
