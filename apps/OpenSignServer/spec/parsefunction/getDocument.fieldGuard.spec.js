import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  INTERNAL_FIELDS,
  NON_OWNER_FIELDS,
  RETURNED_FIELDS,
  projectDocument,
} from '../../cloud/parsefunction/getDocument.js';
import { createCaller, purgeCreatedAccounts, silenceConsole } from '../utils/auth-fixtures.js';
import { seedDocument } from '../utils/document-fixtures.js';

const CLASS_NAME = 'contracts_Document';
const PARSE_BUILT_INS = ['objectId', 'createdAt', 'updatedAt', 'ACL'];

const require = createRequire(import.meta.url);
const MIGRATIONS_DIR = join(import.meta.dirname, '../../databases/migrations');
const FIELD_DECLARATION =
  /^add(String|Number|Boolean|Date|File|GeoPoint|Polygon|Array|Object|Pointer|Relation)$/;
const DATA_ACCESS = /Parse\.(Query|Object|Cloud|User)/;
const PERSISTING_METHODS = ['update', 'save', 'get'];

const recordingSchemaFor = recorded => className => {
  const schema = new Proxy(
    {},
    {
      get: (_target, method) => {
        if (method === 'then') return undefined;
        return (...args) => {
          if (FIELD_DECLARATION.test(method)) {
            recorded[className] = [...(recorded[className] ?? []), args[0]];
          }
          return PERSISTING_METHODS.includes(method) ? Promise.resolve({ fields: {} }) : schema;
        };
      },
    }
  );
  return schema;
};

const migrationDeclaredFields = async className => {
  const recorded = {};
  const newSchema = recordingSchemaFor(recorded);
  const recordingParse = {
    Schema: function Schema(className) {
      return newSchema(className);
    },
  };
  const files = readdirSync(MIGRATIONS_DIR)
    .filter(file => file.endsWith('.cjs'))
    .filter(file => !DATA_ACCESS.test(readFileSync(join(MIGRATIONS_DIR, file), 'utf8')))
    .sort();
  for (const file of files) {
    await require(join(MIGRATIONS_DIR, file)).up(recordingParse);
  }
  return [...new Set(recorded[className] ?? [])];
};

const liveColumns = async () => Object.keys((await new Parse.Schema(CLASS_NAME).get()).fields);

const classifiedColumns = () => [...RETURNED_FIELDS, ...INTERNAL_FIELDS, ...NON_OWNER_FIELDS];

describe('getDocument top level field classification', () => {
  let owner;

  beforeEach(async () => {
    silenceConsole();
    owner = await createCaller('contracts_Admin');
    await seedDocument(owner);
  });

  afterEach(async () => {
    await purgeCreatedAccounts();
  });

  it('classifies every contracts_Document column as returned or removed', async () => {
    const columns = [...(await liveColumns()), ...(await migrationDeclaredFields(CLASS_NAME))];

    const unclassified = [...new Set(columns)].filter(
      column => !PARSE_BUILT_INS.includes(column) && !classifiedColumns().includes(column)
    );

    expect(unclassified)
      .withContext(`unclassified contracts_Document columns: ${unclassified.join(', ')}`)
      .toEqual([]);
  });

  it('lists each column in a single classification', () => {
    const all = classifiedColumns();

    expect(all.filter((field, index) => all.indexOf(field) !== index)).toEqual([]);
  });
});

describe('getDocument projection of non array lists', () => {
  const NON_ARRAY_VALUES = ['signer', 42, { 0: 'signer' }, true];
  const LISTS_BY_CALLER = [
    { isOwner: true, fields: ['Signers', 'AuditTrail', 'Bcc', 'Cc'] },
    { isOwner: false, fields: ['Signers', 'AuditTrail'] },
  ];

  LISTS_BY_CALLER.forEach(({ isOwner, fields }) => {
    fields.forEach(field => {
      it(`returns an empty list for a non array ${field} when isOwner is ${isOwner}`, () => {
        NON_ARRAY_VALUES.forEach(value => {
          expect(projectDocument({ [field]: value }, isOwner)[field]).toEqual([]);
        });
      });
    });
  });

  it('keeps null and missing lists untouched', () => {
    const projected = projectDocument({ Signers: null }, true);

    expect(projected.Signers).toBeNull();
    expect('AuditTrail' in projected).toBeFalse();
  });
});
