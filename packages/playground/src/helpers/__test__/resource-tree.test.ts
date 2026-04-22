import { describe, expect, it } from 'bun:test';
import { Flags, RoleRegistry, Subject } from 'odgn-rights';

import type { PlaygroundConfig } from '../playground-config';
import {
  buildResourceDisplayTree,
  cycleRoleFlag,
  deleteResourceBranch,
  getFlagDetails,
  getOverallAccessState,
  getReferencedPaths,
  renameResourceBranch
} from '../resource-tree';

const createConfig = (): PlaygroundConfig => ({
  resources: [
    {
      children: [
        {
          children: [
            {
              children: [{ name: 'metrics' }, { name: 'settings' }],
              name: 'dashboard'
            }
          ],
          name: 'staging'
        }
      ],
      name: 'workbench'
    }
  ],
  roles: [
    {
      name: 'workbench-guest',
      rights: [{ allow: 'r', path: '/workbench/staging/dashboard/metrics' }]
    },
    {
      name: 'meta-auditor',
      rights: [{ allow: 'r', path: '/meta/prod/users' }]
    }
  ],
  subject: { roles: ['workbench-guest', 'meta-auditor'] }
});

describe('resource display tree', () => {
  it('merges explicit resources with inferred rights-only branches', () => {
    const config = createConfig();
    const registry = RoleRegistry.fromJSON(config.roles);
    const subject = Subject.fromJSON(config.subject, registry);

    const tree = buildResourceDisplayTree(
      config.resources,
      getReferencedPaths(subject)
    );

    expect(tree.map(node => node.name)).toEqual(['workbench', 'meta']);
    expect(tree[1]).toEqual({
      children: [
        {
          children: [{ children: [], inferred: true, name: 'users', path: '/meta/prod/users' }],
          inferred: true,
          name: 'prod',
          path: '/meta/prod'
        }
      ],
      inferred: true,
      name: 'meta',
      path: '/meta'
    });
  });
});

describe('resource tree edits', () => {
  it('materializes the path and cycles exact-path rights for the selected role', () => {
    const nextConfig = cycleRoleFlag(
      createConfig(),
      'meta-auditor',
      '/meta/prod/users',
      Flags.WRITE
    );

    expect(nextConfig.resources[1]).toEqual({
      children: [
        {
          children: [{ name: 'users' }],
          name: 'prod'
        }
      ],
      name: 'meta'
    });
    expect(nextConfig.roles[1]?.rights).toContainEqual({
      allow: 'rw',
      path: '/meta/prod/users'
    });
  });

  it('rewrites only the selected role when renaming a branch', () => {
    const renamed = renameResourceBranch(
      createConfig(),
      'meta-auditor',
      '/meta/prod',
      'production'
    );

    expect(renamed.roles[1]?.rights).toEqual([
      { allow: 'r', path: '/meta/production/users' }
    ]);
    expect(renamed.roles[0]?.rights).toEqual([
      { allow: 'r', path: '/workbench/staging/dashboard/metrics' }
    ]);
  });

  it('deletes a branch and removes matching rights only from the selected role', () => {
    const deleted = deleteResourceBranch(
      createConfig(),
      'meta-auditor',
      '/meta'
    );

    expect(deleted.roles[1]?.rights).toEqual([]);
    expect(deleted.roles[0]?.rights).toEqual([
      { allow: 'r', path: '/workbench/staging/dashboard/metrics' }
    ]);
  });
});

describe('effective access states', () => {
  it('distinguishes explicit deny from implicit block', () => {
    const config: PlaygroundConfig = {
      resources: [{ children: [{ name: 'secret' }], name: 'company' }],
      roles: [
        {
          name: 'employee',
          rights: [
            { allow: 'r', path: '/company/**' },
            { allow: '', deny: 'r', path: '/company/secret' }
          ]
        }
      ],
      subject: { roles: ['employee'] }
    };
    const registry = RoleRegistry.fromJSON(config.roles);
    const subject = Subject.fromJSON(config.subject, registry);

    const denied = getFlagDetails(subject, '/company/secret');
    const implicit = getFlagDetails(subject, '/company/missing');

    expect(getOverallAccessState(denied)).toBe('denied');
    expect(
      denied.find(detail => detail.flag === Flags.READ)?.state
    ).toBe('denied');
    expect(
      implicit.find(detail => detail.flag === Flags.WRITE)?.state
    ).toBe('implicit');
  });
});
