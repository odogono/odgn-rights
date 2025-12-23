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
