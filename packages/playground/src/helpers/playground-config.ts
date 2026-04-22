import {
  RoleRegistry,
  Subject,
  type RoleJSON,
  type SubjectJSON
} from 'odgn-rights';

export type ResourceNode = {
  children?: ResourceNode[];
  name: string;
};

export type PlaygroundConfig = {
  resources: ResourceNode[];
  roles: RoleJSON[];
  subject: SubjectJSON;
};

export const DEFAULT_PLAYGROUND_CONFIG: PlaygroundConfig = {
  resources: [],
  roles: [],
  subject: { rights: [], roles: [] }
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeResourceNodes = (
  value: unknown,
  path: string = 'resources'
): ResourceNode[] => {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array`);
  }

  const siblingNames = new Set<string>();

  return value.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw new Error(`${path}[${index}] must be an object`);
    }

    const rawName = entry.name;
    if (typeof rawName !== 'string') {
      throw new Error(`${path}[${index}].name must be a string`);
    }

    const name = rawName.trim();
    if (!name) {
      throw new Error(`${path}[${index}].name cannot be empty`);
    }
    if (name.includes('/')) {
      throw new Error(`${path}[${index}].name cannot contain "/"`);
    }
    if (siblingNames.has(name)) {
      throw new Error(`Duplicate resource name "${name}" at ${path}`);
    }
    siblingNames.add(name);

    const children = normalizeResourceNodes(
      entry.children,
      `${path}[${index}].children`
    );

    if (children.length > 0) {
      return { children, name };
    }

    return { name };
  });
};

export const normalizePlaygroundConfig = (value: unknown): PlaygroundConfig => {
  if (value === undefined) {
    return DEFAULT_PLAYGROUND_CONFIG;
  }
  if (!isPlainObject(value)) {
    throw new Error('Playground config must be an object');
  }

  const roles = value.roles ?? [];
  if (!Array.isArray(roles)) {
    throw new Error('roles must be an array');
  }

  const subjectValue = value.subject ?? {};
  if (!isPlainObject(subjectValue)) {
    throw new Error('subject must be an object');
  }

  const subjectRoles = subjectValue.roles ?? [];
  if (!Array.isArray(subjectRoles)) {
    throw new Error('subject.roles must be an array');
  }
  if (!subjectRoles.every(role => typeof role === 'string')) {
    throw new Error('subject.roles must contain strings');
  }

  const subjectRights = subjectValue.rights ?? [];
  if (!Array.isArray(subjectRights)) {
    throw new Error('subject.rights must be an array');
  }

  const normalized: PlaygroundConfig = {
    resources: normalizeResourceNodes(value.resources),
    roles: roles as RoleJSON[],
    subject: {
      rights: subjectRights,
      roles: subjectRoles
    }
  };

  const registry = RoleRegistry.fromJSON(normalized.roles);
  Subject.fromJSON(normalized.subject, registry);

  return normalized;
};

export const parsePlaygroundConfig = (content: string): PlaygroundConfig =>
  normalizePlaygroundConfig(JSON.parse(content));

export const serializePlaygroundConfig = (config: PlaygroundConfig): string =>
  JSON.stringify(config, null, 2);
