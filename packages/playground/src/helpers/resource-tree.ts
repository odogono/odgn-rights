import { Flags, Rights, type RightJSON, type Subject } from 'odgn-rights';

import type { PlaygroundConfig, ResourceNode } from './playground-config';

export const RESOURCE_FLAGS = [
  Flags.READ,
  Flags.WRITE,
  Flags.CREATE,
  Flags.DELETE,
  Flags.EXECUTE
] as const;

export type ExactFlagState = 'allow' | 'clear' | 'deny';
export type EffectiveAccessState = 'denied' | 'granted' | 'implicit';

export type ResourceDisplayNode = {
  children: ResourceDisplayNode[];
  inferred: boolean;
  name: string;
  path: string;
};

export type ResourceFlagDetail = {
  flag: Flags;
  matchedRight?: string;
  source?: { name?: string; type: 'direct' | 'role' };
  state: EffectiveAccessState;
};

type MutableDisplayNode = {
  children: Map<string, MutableDisplayNode>;
  inferred: boolean;
  name: string;
  path: string;
};

const FLAG_LETTERS: Record<number, string> = {
  [Flags.CREATE]: 'c',
  [Flags.DELETE]: 'd',
  [Flags.EXECUTE]: 'x',
  [Flags.READ]: 'r',
  [Flags.WRITE]: 'w'
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const normalizeResourcePath = (path: string): string => {
  if (!path || path === '/') {
    return '/';
  }

  const normalized = path
    .replaceAll('\\', '/')
    .split('/')
    .filter(Boolean)
    .join('/');

  return normalized ? `/${normalized}` : '/';
};

export const splitResourcePath = (path: string): string[] =>
  normalizeResourcePath(path)
    .split('/')
    .filter(Boolean);

const joinPath = (segments: string[]): string =>
  segments.length === 0 ? '/' : `/${segments.join('/')}`;

const insertNode = (
  children: Map<string, MutableDisplayNode>,
  segments: string[],
  inferred: boolean,
  parentSegments: string[] = []
) => {
  if (segments.length === 0) {
    return;
  }

  const [head, ...tail] = segments;
  const nextSegments = [...parentSegments, head];
  const existing = children.get(head);

  if (existing) {
    if (!inferred) {
      existing.inferred = false;
    }
    insertNode(existing.children, tail, inferred, nextSegments);
    return;
  }

  const node: MutableDisplayNode = {
    children: new Map(),
    inferred,
    name: head,
    path: joinPath(nextSegments)
  };
  children.set(head, node);

  insertNode(node.children, tail, inferred, nextSegments);
};

const addExplicitResources = (
  children: Map<string, MutableDisplayNode>,
  nodes: ResourceNode[],
  parentSegments: string[] = []
) => {
  for (const node of nodes) {
    insertNode(children, [node.name], false, parentSegments);
    const current = children.get(node.name);
    if (!current) {
      continue;
    }
    addExplicitResources(current.children, node.children ?? [], [
      ...parentSegments,
      node.name
    ]);
  }
};

const toDisplayNodes = (
  children: Map<string, MutableDisplayNode>
): ResourceDisplayNode[] =>
  [...children.values()].map(child => ({
    children: toDisplayNodes(child.children),
    inferred: child.inferred,
    name: child.name,
    path: child.path
  }));

export const buildResourceDisplayTree = (
  resources: ResourceNode[],
  referencedPaths: string[]
): ResourceDisplayNode[] => {
  const rootChildren = new Map<string, MutableDisplayNode>();
  addExplicitResources(rootChildren, resources);

  for (const path of referencedPaths) {
    const segments = splitResourcePath(path);
    insertNode(rootChildren, segments, true);
  }

  return toDisplayNodes(rootChildren);
};

export const getReferencedPaths = (subject: Subject): string[] => {
  const paths = new Set<string>();

  subject.allRights().forEach(({ right }) => {
    const normalized = normalizeResourcePath(right.path);
    if (normalized !== '/') {
      paths.add(normalized);
    }
  });

  return [...paths];
};

export const getFlagDetails = (
  subject: Subject,
  path: string
): ResourceFlagDetail[] =>
  RESOURCE_FLAGS.map(flag => {
    const detail = subject.explain(path, flag).details[0];
    if (!detail) {
      return { flag, state: 'implicit' };
    }
    if (detail.allowed) {
      return {
        flag,
        matchedRight: detail.right?.toString(),
        source: detail.source,
        state: 'granted'
      };
    }
    if (detail.right) {
      return {
        flag,
        matchedRight: detail.right.toString(),
        source: detail.source,
        state: 'denied'
      };
    }
    return { flag, state: 'implicit' };
  });

export const getOverallAccessState = (
  details: ResourceFlagDetail[]
): EffectiveAccessState => {
  if (details.some(detail => detail.state === 'granted')) {
    return 'granted';
  }
  if (details.some(detail => detail.state === 'denied')) {
    return 'denied';
  }
  return 'implicit';
};

const getExactRightsForRole = (
  config: PlaygroundConfig,
  roleName: string,
  path: string
): RightJSON[] => {
  const role = config.roles.find(entry => entry.name === roleName);
  if (!role) {
    return [];
  }

  const normalizedPath = normalizeResourcePath(path);
  return (role.rights ?? []).filter(
    (right): right is RightJSON =>
      isPlainObject(right) &&
      typeof right.path === 'string' &&
      normalizeResourcePath(right.path) === normalizedPath
  );
};

export const getExactRoleFlagState = (
  config: PlaygroundConfig,
  roleName: string | null,
  path: string,
  flag: Flags
): ExactFlagState => {
  if (!roleName) {
    return 'clear';
  }

  const rights = getExactRightsForRole(config, roleName, path);
  if (rights.length === 0) {
    return 'clear';
  }

  const detail = Rights.fromJSON(rights).explain(path, flag).details[0];
  if (!detail) {
    return 'clear';
  }
  if (detail.allowed) {
    return 'allow';
  }
  return detail.right ? 'deny' : 'clear';
};

const nextFlagState = (state: ExactFlagState): ExactFlagState => {
  switch (state) {
    case 'clear':
      return 'allow';
    case 'allow':
      return 'deny';
    case 'deny':
      return 'clear';
  }
};

const isManagedRight = (right: RightJSON, path: string): boolean =>
  normalizeResourcePath(right.path) === normalizeResourcePath(path) &&
  !right.description &&
  right.priority === undefined &&
  (right.tags?.length ?? 0) === 0 &&
  !right.validFrom &&
  !right.validUntil;

const updateLetters = (
  current: string | undefined,
  letter: string,
  include: boolean
): string => {
  const next = new Set((current ?? '').split('').filter(Boolean));
  if (include) {
    next.add(letter);
  } else {
    next.delete(letter);
  }
  return [...next].sort().join('');
};

const updateManagedRightState = (
  right: RightJSON,
  flag: Flags,
  state: ExactFlagState
): RightJSON | null => {
  const letter = FLAG_LETTERS[flag];
  const allow = updateLetters(right.allow, letter, state === 'allow');
  const deny = updateLetters(right.deny, letter, state === 'deny');

  if (!allow && !deny) {
    return null;
  }

  return {
    ...right,
    allow,
    deny: deny || undefined
  };
};

const updateRoleRights = (
  config: PlaygroundConfig,
  roleName: string,
  updater: (rights: RightJSON[]) => RightJSON[]
): PlaygroundConfig => ({
  ...config,
  roles: config.roles.map(role =>
    role.name === roleName ? { ...role, rights: updater(role.rights ?? []) } : role
  )
});

export const ensureResourcePath = (
  resources: ResourceNode[],
  path: string
): ResourceNode[] => {
  const segments = splitResourcePath(path);

  const ensureChildren = (
    nodes: ResourceNode[],
    remaining: string[]
  ): ResourceNode[] => {
    if (remaining.length === 0) {
      return nodes.map(node => ({
        ...node,
        children: node.children ? [...node.children] : undefined
      }));
    }

    const [head, ...tail] = remaining;
    const existingIndex = nodes.findIndex(node => node.name === head);

    if (existingIndex === -1) {
      const rootNode: ResourceNode = { name: head };
      let currentNode = rootNode;

      tail.forEach(name => {
        const child: ResourceNode = { name };
        currentNode.children = [child];
        currentNode = child;
      });

      return [...nodes, rootNode];
    }

    return nodes.map((node, index) => {
      if (index !== existingIndex) {
        return {
          ...node,
          children: node.children ? [...node.children] : undefined
        };
      }

      const children = ensureChildren(node.children ?? [], tail);
      return { ...node, children: children.length > 0 ? children : undefined };
    });
  };

  return ensureChildren(resources, segments);
};

export const addResourceNode = (
  config: PlaygroundConfig,
  parentPath: string | null,
  name: string
): PlaygroundConfig => {
  const nextName = name.trim();
  if (!nextName) {
    throw new Error('Resource name cannot be empty');
  }
  if (nextName.includes('/')) {
    throw new Error('Resource name cannot contain "/"');
  }

  const baseResources = parentPath
    ? ensureResourcePath(config.resources, parentPath)
    : [...config.resources];
  const segments = parentPath ? splitResourcePath(parentPath) : [];

  const appendChild = (nodes: ResourceNode[]): ResourceNode[] => {
    if (nodes.some(node => node.name === nextName)) {
      throw new Error(`A sibling named "${nextName}" already exists`);
    }
    return [...nodes, { name: nextName }];
  };

  const addAtPath = (nodes: ResourceNode[], remaining: string[]): ResourceNode[] => {
    if (remaining.length === 0) {
      return appendChild(nodes);
    }

    const [head, ...tail] = remaining;
    return nodes.map(node => {
      if (node.name !== head) {
        return {
          ...node,
          children: node.children ? [...node.children] : undefined
        };
      }

      const children = addAtPath(node.children ?? [], tail);
      return { ...node, children };
    });
  };

  return {
    ...config,
    resources: addAtPath(baseResources, segments)
  };
};

const rewriteBranchPath = (
  path: string,
  oldPrefix: string,
  newPrefix: string
): string => {
  const normalizedPath = normalizeResourcePath(path);
  const normalizedOldPrefix = normalizeResourcePath(oldPrefix);
  const normalizedNewPrefix = normalizeResourcePath(newPrefix);

  if (normalizedPath === normalizedOldPrefix) {
    return normalizedNewPrefix;
  }
  if (normalizedPath.startsWith(`${normalizedOldPrefix}/`)) {
    return `${normalizedNewPrefix}${normalizedPath.slice(normalizedOldPrefix.length)}`;
  }
  return normalizedPath;
};

const updateRoleBranchPaths = (
  config: PlaygroundConfig,
  roleName: string,
  oldPath: string,
  newPath: string
): PlaygroundConfig =>
  updateRoleRights(config, roleName, rights =>
    rights.map(right => ({
      ...right,
      path: rewriteBranchPath(right.path, oldPath, newPath)
    }))
  );

export const renameResourceBranch = (
  config: PlaygroundConfig,
  roleName: string,
  path: string,
  nextName: string
): PlaygroundConfig => {
  const trimmedName = nextName.trim();
  if (!trimmedName) {
    throw new Error('Resource name cannot be empty');
  }
  if (trimmedName.includes('/')) {
    throw new Error('Resource name cannot contain "/"');
  }

  const normalizedPath = normalizeResourcePath(path);
  const segments = splitResourcePath(normalizedPath);
  const baseResources = ensureResourcePath(config.resources, normalizedPath);
  const parentPath = joinPath(segments.slice(0, -1));
  const newPath = joinPath([...segments.slice(0, -1), trimmedName]);

  const renameAtPath = (
    nodes: ResourceNode[],
    remaining: string[]
  ): ResourceNode[] => {
    const [head, ...tail] = remaining;

    if (tail.length === 0) {
      const existing = nodes.find(node => node.name === trimmedName);
      if (existing && existing.name !== head) {
        throw new Error(`A sibling named "${trimmedName}" already exists`);
      }

      return nodes.map(node =>
        node.name === head
          ? {
              ...node,
              name: trimmedName,
              children: node.children ? [...node.children] : undefined
            }
          : {
              ...node,
              children: node.children ? [...node.children] : undefined
            }
      );
    }

    return nodes.map(node => {
      if (node.name !== head) {
        return {
          ...node,
          children: node.children ? [...node.children] : undefined
        };
      }
      return {
        ...node,
        children: renameAtPath(node.children ?? [], tail)
      };
    });
  };

  const renamedConfig = {
    ...config,
    resources: renameAtPath(baseResources, segments)
  };

  if (parentPath === newPath || normalizedPath === newPath) {
    return renamedConfig;
  }

  return updateRoleBranchPaths(renamedConfig, roleName, normalizedPath, newPath);
};

const pathMatchesBranch = (candidatePath: string, branchPath: string): boolean => {
  const normalizedCandidate = normalizeResourcePath(candidatePath);
  const normalizedBranch = normalizeResourcePath(branchPath);
  return (
    normalizedCandidate === normalizedBranch ||
    normalizedCandidate.startsWith(`${normalizedBranch}/`)
  );
};

export const deleteResourceBranch = (
  config: PlaygroundConfig,
  roleName: string,
  path: string
): PlaygroundConfig => {
  const normalizedPath = normalizeResourcePath(path);
  const segments = splitResourcePath(normalizedPath);

  const deleteAtPath = (
    nodes: ResourceNode[],
    remaining: string[]
  ): ResourceNode[] => {
    const [head, ...tail] = remaining;
    if (tail.length === 0) {
      return nodes
        .filter(node => node.name !== head)
        .map(node => ({
          ...node,
          children: node.children ? [...node.children] : undefined
        }));
    }

    return nodes.map(node => {
      if (node.name !== head) {
        return {
          ...node,
          children: node.children ? [...node.children] : undefined
        };
      }

      const children = deleteAtPath(node.children ?? [], tail);
      return { ...node, children: children.length > 0 ? children : undefined };
    });
  };

  const withoutBranch = {
    ...config,
    resources: deleteAtPath(config.resources, segments)
  };

  return updateRoleRights(withoutBranch, roleName, rights =>
    rights.filter(right => !pathMatchesBranch(right.path, normalizedPath))
  );
};

export const cycleRoleFlag = (
  config: PlaygroundConfig,
  roleName: string,
  path: string,
  flag: Flags
): PlaygroundConfig => {
  const normalizedPath = normalizeResourcePath(path);
  const currentState = getExactRoleFlagState(config, roleName, normalizedPath, flag);
  const desiredState = nextFlagState(currentState);
  const nextResources = ensureResourcePath(config.resources, normalizedPath);

  return updateRoleRights(
    {
      ...config,
      resources: nextResources
    },
    roleName,
    rights => {
      let managedIndex = rights.findIndex(
        right => isManagedRight(right, normalizedPath)
      );
      const nextRights = rights.map(right => ({ ...right }));

      if (managedIndex === -1 && desiredState !== 'clear') {
        nextRights.push({ allow: '', path: normalizedPath });
        managedIndex = nextRights.length - 1;
      }

      if (managedIndex === -1) {
        return nextRights;
      }

      const updated = updateManagedRightState(
        nextRights[managedIndex]!,
        flag,
        desiredState
      );

      if (!updated) {
        nextRights.splice(managedIndex, 1);
      } else {
        nextRights[managedIndex] = updated;
      }

      return nextRights;
    }
  );
};
