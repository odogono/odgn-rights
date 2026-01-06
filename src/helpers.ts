import { Flags, hasBit } from './constants';

export type ParsedPath = {
  negated: boolean;
  path: string;
};

/**
 * Parse a path string, detecting and stripping negation prefix.
 * Handles double negation (!! becomes positive).
 *
 * @example
 * parsePath('!/api/internal') // { path: '/api/internal', negated: true }
 * parsePath('/api/public')    // { path: '/api/public', negated: false }
 * parsePath('!!/api/path')    // { path: '/api/path', negated: false }
 */
export const parsePath = (p: string): ParsedPath => {
  let trimmed = p.trim();
  let negated = false;

  // Handle negation prefix(es) - !! cancels out
  while (trimmed.startsWith('!')) {
    negated = !negated;
    trimmed = trimmed.slice(1).trimStart();
  }

  return {
    negated,
    path: normalizePath(trimmed)
  };
};

export const normalizePath = (p: string): string => {
  if (!p) {
    return '/';
  }
  let out = p.trim();
  if (!out.startsWith('/')) {
    out = '/' + out;
  }
  out = out.replace(/\/+/, '/');
  out = out.replaceAll(/\/+/g, '/');
  if (out.length > 1 && out.endsWith('/')) {
    out = out.slice(0, -1);
  }
  return out;
};

export const lettersFromMask = (mask: number): string => {
  if (mask === Flags.ALL) {
    return '*';
  }
  const letters: string[] = [];
  if (hasBit(mask, Flags.READ)) {
    letters.push('r');
  }
  if (hasBit(mask, Flags.WRITE)) {
    letters.push('w');
  }
  if (hasBit(mask, Flags.CREATE)) {
    letters.push('c');
  }
  if (hasBit(mask, Flags.DELETE)) {
    letters.push('d');
  }
  if (hasBit(mask, Flags.EXECUTE)) {
    letters.push('x');
  }
  return letters.join('');
};
