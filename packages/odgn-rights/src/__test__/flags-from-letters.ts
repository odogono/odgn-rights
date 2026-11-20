import { Flags } from '../index';

// How the conformance cases write flags: letters (r w c d x), '*' for all, or
// '' for none. Shared by every conformance runner.

const LETTERS: Record<string, Flags> = {
  c: Flags.CREATE,
  d: Flags.DELETE,
  r: Flags.READ,
  w: Flags.WRITE,
  x: Flags.EXECUTE
};

// A check may combine flags, which the Flags type does not list, so the mask
// is cast back to it.
export const flagsFromLetters = (letters: string): Flags => {
  if (letters === '*') {
    return Flags.ALL;
  }
  let mask = 0;
  for (const ch of letters) {
    mask |= LETTERS[ch] ?? 0;
  }
  return mask as Flags;
};
