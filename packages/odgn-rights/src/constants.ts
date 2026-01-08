/* eslint-disable perfectionist/sort-objects */
export const Flags = {
  EXECUTE: 16,
  READ: 1,
  DELETE: 4,
  CREATE: 8,
  WRITE: 2,
  ALL: 31
} as const;

export type Flags = (typeof Flags)[keyof typeof Flags];

export const ALL_BITS: Flags[] = [
  Flags.READ,
  Flags.WRITE,
  Flags.DELETE,
  Flags.CREATE,
  Flags.EXECUTE
];

export const hasBit = (mask: number, bit: number) => (mask & bit) === bit;
