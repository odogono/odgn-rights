import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import {
  Flags,
  Rights,
  RoleRegistry,
  Subject,
  type Right
} from 'odgn-rights';

import {
  DEFAULT_PLAYGROUND_CONFIG,
  parsePlaygroundConfig,
  type PlaygroundConfig
} from '../helpers/playground-config';

// ============================================
// Primitive Atoms (source of truth)
// ============================================

export const configAtom = atom<PlaygroundConfig>(DEFAULT_PLAYGROUND_CONFIG);

export const editorContentAtom = atom<string>(
  JSON.stringify(DEFAULT_PLAYGROUND_CONFIG, null, 2)
);
export const editorFormatAtom = atomWithStorage<'json' | 'string'>(
  'playground-format',
  'json'
);

export const screenModeAtom = atomWithStorage<'classic' | 'resources'>(
  'playground-screen-mode',
  'classic'
);

export const testPathAtom = atom<string>('');
export const testFlagsAtom = atom<number>(0); // Bitmask

export const simulatedTimeAtom = atom<Date | null>(null);

export type TestHistoryEntry = {
  allowed: boolean;
  flags: number;
  id: string;
  path: string;
  timestamp: Date;
};

export const testHistoryAtom = atom<TestHistoryEntry[]>([]);

export const selectedNodeAtom = atom<string | null>(null);

export const showDocAtom = atom<boolean>(false);
const selectedResourceRoleStateAtom = atom<string | null>(null);

export type ExplainResult = {
  allowed: boolean;
  details: Array<{
    allowed: boolean;
    bit: Flags;
    right?: Right;
    source?: { name?: string; type: 'direct' | 'role' };
  }>;
};

// ============================================
// Derived Atoms (computed from primitives)
// ============================================

export const roleRegistryAtom = atom(get => {
  const config = get(configAtom);
  return RoleRegistry.fromJSON(config.roles);
});

export const subjectAtom = atom(get => {
  const config = get(configAtom);
  const registry = get(roleRegistryAtom);
  return Subject.fromJSON(config.subject, registry);
});

export const validationErrorAtom = atom<string | null>(get => {
  const content = get(editorContentAtom);
  const format = get(editorFormatAtom);
  if (!content) {
    return null;
  }
  try {
    if (format === 'json') {
      parsePlaygroundConfig(content);
    } else {
      Rights.parse(content);
    }
    return null;
  } catch (error) {
    return (error as Error).message;
  }
});

export const editableResourceRolesAtom = atom(get => {
  const config = get(configAtom);
  const definedRoles = new Set(config.roles.map(role => role.name));
  return (config.subject.roles ?? []).filter(
    (roleName): roleName is string => definedRoles.has(roleName)
  );
});

export const selectedResourceRoleAtom = atom(
  get => {
    const explicitSelection = get(selectedResourceRoleStateAtom);
    const availableRoles = get(editableResourceRolesAtom);

    if (explicitSelection && availableRoles.includes(explicitSelection)) {
      return explicitSelection;
    }

    return availableRoles[0] ?? null;
  },
  (_get, set, roleName: string | null) => {
    set(selectedResourceRoleStateAtom, roleName);
  }
);

// Atom that computes explain() result for current test
export const testResultAtom = atom(get => {
  const subject = get(subjectAtom);
  const path = get(testPathAtom);
  const flags = get(testFlagsAtom);
  const simulatedTime = get(simulatedTimeAtom);

  if (!path || flags === 0) {
    return null;
  }

  const context = simulatedTime ? { _now: simulatedTime } : undefined;
  return subject.explain(path, flags as Flags, context) as ExplainResult;
});
