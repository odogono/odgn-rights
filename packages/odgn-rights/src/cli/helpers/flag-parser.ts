import { Flags } from '@/constants';

const FLAG_MAP: Record<string, Flags> = {
  '*': Flags.ALL,
  ALL: Flags.ALL,
  C: Flags.CREATE,
  CREATE: Flags.CREATE,
  D: Flags.DELETE,
  DELETE: Flags.DELETE,
  EXECUTE: Flags.EXECUTE,
  R: Flags.READ,
  READ: Flags.READ,
  W: Flags.WRITE,
  WRITE: Flags.WRITE,
  X: Flags.EXECUTE
};

export const parseFlag = (input: string): Flags => {
  const normalized = input.toUpperCase().trim();
  const flag = FLAG_MAP[normalized];
  if (flag === undefined) {
    throw new Error(
      `Unknown flag: ${input}. Valid flags: READ, WRITE, CREATE, DELETE, EXECUTE, ALL`
    );
  }
  return flag;
};

export const parseFlags = (input: string): number => {
  if (input.includes(',')) {
    return input
      .split(',')
      .reduce((acc: number, f) => acc | parseFlag(f.trim()), 0);
  }

  try {
    return parseFlag(input);
  } catch {
    let combined = 0;
    for (const ch of input.toUpperCase()) {
      combined |= parseFlag(ch);
    }
    return combined;
  }
};
