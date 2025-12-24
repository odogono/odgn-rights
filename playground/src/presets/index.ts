import type { RoleJSON, SubjectJSON } from '@/index';

export type Preset = {
  config: {
    roles: RoleJSON[];
    subject: SubjectJSON;
  };
  description: string;
  name: string;
};

export const PRESETS: Record<string, Preset> = {
  'basic-rbac': {
    config: {
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
  'tagged-rights': {
    config: {
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
