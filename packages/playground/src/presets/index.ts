import type { PlaygroundConfig } from '../helpers/playground-config';

export type Preset = {
  config: PlaygroundConfig;
  description: string;
  name: string;
};

export const PRESETS: Record<string, Preset> = {
  'basic-rbac': {
    config: {
      resources: [],
      roles: [
        {
          name: 'viewer',
          rights: [{ allow: 'r', path: '/public/**' }]
        },
        {
          inherits: ['viewer'],
          name: 'editor',
          rights: [{ allow: 'rwc', path: '/content/**' }]
        }
      ],
      subject: { roles: ['editor'] }
    },
    description: 'Simple role-based access control',
    name: 'Basic RBAC'
  },
  'complex-hierarchy': {
    config: {
      resources: [],
      roles: [
        {
          name: 'base-employee',
          rights: [
            { allow: 'r', path: '/company/announcements' },
            { allow: 'r', path: '/company/cafeteria' }
          ]
        },
        {
          inherits: ['base-employee'],
          name: 'engineer',
          rights: [
            { allow: 'rw', path: '/code/**' },
            { allow: 'r', path: '/docs/**' }
          ]
        },
        {
          inherits: ['engineer'],
          name: 'lead-engineer',
          rights: [
            { allow: 'rwcxd', path: '/code/main/**' },
            { allow: 'rw', path: '/infrastructure/**' }
          ]
        },
        {
          inherits: ['base-employee'],
          name: 'hr',
          rights: [
            { allow: 'rwc', path: '/people/**' },
            { allow: '', deny: '*', path: '/code/**' }
          ]
        }
      ],
      subject: { roles: ['lead-engineer', 'hr'] }
    },
    description:
      'Multiple inheritance and mixed roles showing specificity and conflict resolution',
    name: 'Complex Hierarchy'
  },
  'deny-override': {
    config: {
      resources: [],
      roles: [
        {
          name: 'restricted-admin',
          rights: [
            { allow: '*', path: '/**' },
            { allow: '', deny: '*', path: '/system/**' }
          ]
        }
      ],
      subject: { roles: ['restricted-admin'] }
    },
    description: 'Demonstrating deny rules overriding allow',
    name: 'Deny Override'
  },
  'fine-grained-resource': {
    config: {
      resources: [],
      roles: [
        {
          name: 'manager',
          rights: [
            { allow: 'r', path: '/org/projects/**' },
            { allow: 'rw', path: '/org/projects/active/**' },
            { allow: 'rwcxd', path: '/org/projects/active/my-project/**' },
            {
              allow: '',
              deny: 'd',
              path: '/org/projects/active/my-project/core-files'
            }
          ]
        }
      ],
      subject: {
        rights: [
          { allow: 'd', path: '/org/projects/active/my-project/core-files' }
        ],
        roles: ['manager']
      }
    },
    description: 'Path specificity nested deep with direct subject overrides',
    name: 'Fine-Grained Resources'
  },
  'resource-tree-authoring': {
    config: {
      resources: [
        {
          children: [
            {
              children: [
                {
                  children: [{ name: 'metrics' }, { name: 'settings' }],
                  name: 'dashboard'
                },
                {
                  children: [{ name: 'users' }],
                  name: 'admin'
                }
              ],
              name: 'staging'
            }
          ],
          name: 'workbench'
        },
        {
          "children": [
            {
              "children": [
                {
                  "name": "alarms"
                },
                {
                  "name": "api-tokens"
                },
                {
                  "name": "audit-log"
                },
                {
                  "name": "certificates"
                },
                {
                  "name": "controller-defs"
                },
                {
                  "name": "controllers"
                },
                {
                  "name": "environments"
                },
                {
                  "name": "instances"
                },
                {
                  "name": "organisations"
                },
                {
                  "name": "oauth"
                },
                {
                  "name": "permissions"
                },
                {
                  "name": "routers"
                },
                {
                  "name": "sites"
                }
              ],
              "name": "prod"
            }
          ],
          "name": "meta"
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
    },
    description:
      'Resource tree editing with explicit resources and inferred rights-only branches',
    name: 'Resource Tree Authoring'
  },
  'tagged-rights': {
    config: {
      resources: [],
      roles: [
        {
          name: 'auditor',
          rights: [
            { allow: 'r', path: '/**', tags: ['audit', 'read-only'] },
            { allow: 'r', path: '/logs/**', tags: ['audit', 'critical'] }
          ]
        },
        {
          name: 'operator',
          rights: [
            { allow: 'x', path: '/scripts/**', tags: ['ops'] },
            { allow: 'rw', path: '/temp/**', tags: ['ops', 'transient'] }
          ]
        }
      ],
      subject: { roles: ['auditor', 'operator'] }
    },
    description:
      'Using tags to categorize and manage rights across different roles',
    name: 'Tagged Rights'
  },
  'time-based': {
    config: {
      resources: [],
      roles: [],
      subject: {
        rights: [
          {
            allow: '*',
            path: '/beta/**',
            validFrom: '2025-01-01T00:00:00Z',
            validUntil: '2025-12-31T23:59:59Z'
          }
        ]
      }
    },
    description: 'Rights with validity windows',
    name: 'Time-Based Rights'
  }
};
