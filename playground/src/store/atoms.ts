import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

import {
  Flags,
  Rights,
  RoleRegistry,
  Subject,
  type Right,
  type RoleJSON,
  type SubjectJSON
} from '@/index';

// ============================================
// Primitive Atoms (source of truth)
// ============================================

export type PlaygroundConfig = {
  roles: RoleJSON[];
  subject: SubjectJSON;
};

export const configAtom = atom<PlaygroundConfig>({
  roles: [],
  subject: { rights: [], roles: [] }
});

export const editorContentAtom = atom<string>('');
export const editorFormatAtom = atomWithStorage<'json' | 'string'>(
  'playground-format',
  'json'
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
      JSON.parse(content);
    } else {
      Rights.parse(content);
    }
    return null;
  } catch (error) {
    return (error as Error).message;
  }
});

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
  return subject.explain(path, flags as any, context) as ExplainResult;
});
