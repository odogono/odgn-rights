// playground/src/helpers/flags.ts
import { Flags } from 'odgn-rights';

export const getFlagName = (bit: number): string => {
  switch (bit) {
    case Flags.READ:
      return 'READ';
    case Flags.WRITE:
      return 'WRITE';
    case Flags.CREATE:
      return 'CREATE';
    case Flags.DELETE:
      return 'DELETE';
    case Flags.EXECUTE:
      return 'EXECUTE';
    default:
      return bit.toString();
  }
};

export const getFlagSummary = (flags: number): string => {
  const res = [];
  if (flags & Flags.READ) {
    res.push('R');
  }
  if (flags & Flags.WRITE) {
    res.push('W');
  }
  if (flags & Flags.CREATE) {
    res.push('C');
  }
  if (flags & Flags.DELETE) {
    res.push('D');
  }
  if (flags & Flags.EXECUTE) {
    res.push('X');
  }
  return res.join('');
};

export const FLAG_OPTIONS = [
  { flag: Flags.READ, key: 'r', label: 'Read' },
  { flag: Flags.WRITE, key: 'w', label: 'Write' },
  { flag: Flags.CREATE, key: 'c', label: 'Create' },
  { flag: Flags.DELETE, key: 'd', label: 'Delete' },
  { flag: Flags.EXECUTE, key: 'x', label: 'Execute' }
];
