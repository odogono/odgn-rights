import { join } from 'node:path';
import { SQL } from 'bun';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { flagsFromLetters } from '../../__test__/flags-from-letters';
import { type RoleJSON, type SubjectJSON } from '../../index';
import { PostgresAdapter } from '../postgres-adapter';
import {
  createTableNames,
  generatePostgresDropSchema,
  generatePostgresSchema,
  postgresRightConflictTarget,
  rightIdentityIndexName
} from '../schema';
import type { TableNames } from '../types';

// Runs the language-neutral cases in /conformance/postgres, which the Go
// adapter (go/postgres) runs too, against the TypeScript PostgresAdapter.
// They need a Postgres: set ODGN_RIGHTS_TEST_POSTGRES_URL to run them.

const DIR = join(import.meta.dir, '../../../../../conformance/postgres');
const SCHEMA_FILE = join(DIR, 'schema.sql');
const PREFIX_PLACEHOLDER = '{{prefix}}';
const url = process.env.ODGN_RIGHTS_TEST_POSTGRES_URL;

// The tables migrate() creates: the schema, then the right identity index.
const migratedSchema = (tables: TableNames): string =>
  `${generatePostgresSchema(tables)}
CREATE UNIQUE INDEX IF NOT EXISTS ${rightIdentityIndexName(tables)} ON ${tables.rights} ${postgresRightConflictTarget};
`;

// The Go adapter's tests create their tables from schema.sql, so it must be
// what this adapter's migrate creates.
describe('conformance/postgres/schema.sql', () => {
  it('matches the schema migrate() runs', async () => {
    const expected = migratedSchema(createTableNames(PREFIX_PLACEHOLDER));
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

  // The text check above compares the SQL; this compares what Postgres
  // actually builds from migrate() and from schema.sql.
  it('schema.sql creates the same tables, columns and indexes as migrate()', async () => {
    const describeTables = async (prefix: string) => {
      const columns = await sql.unsafe(
        `SELECT replace(table_name, $1, '') AS t, column_name, data_type, is_nullable,
                replace(coalesce(column_default, ''), $1, '') AS column_default
         FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name LIKE $1 || '%'
         ORDER BY 1, 2`,
        [prefix]
      );
      const indexes = await sql.unsafe(
        `SELECT replace(indexdef, $1, '') AS def FROM pg_indexes
         WHERE schemaname = current_schema() AND tablename LIKE $1 || '%'
         ORDER BY 1`,
        [prefix]
      );
      return { columns: [...columns], indexes: [...indexes] };
    };
    // Equal-length prefixes, because Postgres cuts the names it makes up for
    // constraints to 63 characters.
    const migrated = createTableNames('confmig_');
    const fromFile = createTableNames('confsql_');
    await sql.unsafe(generatePostgresDropSchema(migrated));
    await sql.unsafe(generatePostgresDropSchema(fromFile));
    const adapter = new PostgresAdapter({ tablePrefix: 'confmig_', url });
    await adapter.connect();
    try {
      await adapter.migrate();
      await sql.unsafe(
        (await Bun.file(SCHEMA_FILE).text()).replaceAll(
          PREFIX_PLACEHOLDER,
          'confsql_'
        )
      );
      expect(await describeTables('confsql_')).toEqual(
        await describeTables('confmig_')
      );
    } finally {
      await adapter.disconnect();
      await sql.unsafe(generatePostgresDropSchema(migrated));
      await sql.unsafe(generatePostgresDropSchema(fromFile));
    }
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
