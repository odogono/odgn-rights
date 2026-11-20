import { join } from 'node:path';
import { SQL } from 'bun';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { Flags, type RoleJSON, type SubjectJSON } from '../../index';
import { PostgresAdapter } from '../postgres-adapter';
import {
  createTableNames,
  generatePostgresDropSchema,
  generatePostgresSchema
} from '../schema';

// Runs the language-neutral cases in /conformance/postgres, which the Go
// adapter (go/postgres) runs too, against the TypeScript PostgresAdapter.
// They need a Postgres: set ODGN_RIGHTS_TEST_POSTGRES_URL to run them.

const DIR = join(import.meta.dir, '../../../../../conformance/postgres');
const SCHEMA_FILE = join(DIR, 'schema.sql');
const PREFIX_PLACEHOLDER = '{{prefix}}';
const url = process.env.ODGN_RIGHTS_TEST_POSTGRES_URL;

// The Go adapter's tests create their tables from schema.sql, so it must be
// what this adapter's migrate creates.
describe('conformance/postgres/schema.sql', () => {
  it('matches generatePostgresSchema', async () => {
    const expected = generatePostgresSchema(
      createTableNames(PREFIX_PLACEHOLDER)
    );
    if (process.env.UPDATE_CONFORMANCE_SCHEMA) {
      await Bun.write(SCHEMA_FILE, expected);
    }
    expect(await Bun.file(SCHEMA_FILE).text()).toBe(expected);
  });
});

type Row = Record<string, boolean | null | number | string>;

type Case = {
  expect: {
    registry: RoleJSON[];
    revision: number;
    subjects: {
      checks?: { expect: boolean; flags: string; now?: string; path: string }[];
      identifier: string;
      subject: SubjectJSON | null;
    }[];
  };
  name: string;
  rows: {
    registry_revision?: number;
    rights?: Row[];
    role_inheritance?: Row[];
    role_rights?: Row[];
    roles?: Row[];
    subject_rights?: Row[];
    subject_roles?: Row[];
    subjects?: Row[];
  };
};

// Insertion order, so foreign keys resolve.
const TABLES = [
  'rights',
  'roles',
  'role_rights',
  'role_inheritance',
  'subjects',
  'subject_roles',
  'subject_rights'
] as const;

const LETTERS: Record<string, Flags> = {
  c: Flags.CREATE,
  d: Flags.DELETE,
  r: Flags.READ,
  w: Flags.WRITE,
  x: Flags.EXECUTE
};

const flagsFromLetters = (letters: string): Flags => {
  if (letters === '*') {
    return Flags.ALL;
  }
  let mask = 0;
  for (const ch of letters) {
    mask |= LETTERS[ch] ?? 0;
  }
  return mask as Flags;
};

const { cases } = (await Bun.file(join(DIR, 'cases.json')).json()) as {
  cases: Case[];
};

describe.skipIf(!url)('conformance/postgres/cases.json', () => {
  let sql: SQL;

  beforeAll(() => {
    sql = new SQL({ max: 1, url: url! });
  });

  afterAll(async () => {
    await sql?.end();
  });

  cases.forEach((c, index) => {
    it(c.name, async () => {
      // Each case gets its own tables, named by prefix.
      const prefix = `conf${index}_`;
      const tables = createTableNames(prefix);
      await sql.unsafe(generatePostgresDropSchema(tables));
      const adapter = new PostgresAdapter({ tablePrefix: prefix, url });
      await adapter.connect();
      try {
        await adapter.migrate();
        for (const table of TABLES) {
          for (const row of c.rows[table] ?? []) {
            const columns = Object.keys(row);
            await sql.unsafe(
              `INSERT INTO ${prefix}${table} (${columns.join(', ')}) VALUES (${columns
                .map((_, i) => `$${i + 1}`)
                .join(', ')})`,
              columns.map(column => row[column])
            );
          }
        }
        if (c.rows.registry_revision !== undefined) {
          await sql.unsafe(
            `UPDATE ${tables.roleRegistryState} SET revision = $1 WHERE singleton = 1`,
            [c.rows.registry_revision]
          );
        }

        const { registry, revision } = await adapter.loadRegistrySnapshot();
        expect(revision).toBe(c.expect.revision);
        expect(registry.toJSON()).toEqual(c.expect.registry);

        for (const want of c.expect.subjects) {
          const subject = await adapter.loadSubject(want.identifier, registry);
          expect({
            identifier: want.identifier,
            subject: subject?.toJSON() ?? null
          }).toEqual({ identifier: want.identifier, subject: want.subject });
          for (const check of want.checks ?? []) {
            const got = subject!.has(
              check.path,
              flagsFromLetters(check.flags),
              check.now ? { _now: new Date(check.now) } : undefined
            );
            expect({ ...check, got }).toEqual({ ...check, got: check.expect });
          }
        }
      } finally {
        await adapter.disconnect();
        await sql.unsafe(generatePostgresDropSchema(tables));
      }
    });
  });
});
