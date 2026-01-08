import { Flags } from '../../constants';

export const colors = {
  bold: (s: string) => `\u001b[1m${s}\u001b[0m`,
  cyan: (s: string) => `\u001b[36m${s}\u001b[0m`,
  dim: (s: string) => `\u001b[2m${s}\u001b[0m`,
  green: (s: string) => `\u001b[32m${s}\u001b[0m`,
  red: (s: string) => `\u001b[31m${s}\u001b[0m`,
  yellow: (s: string) => `\u001b[33m${s}\u001b[0m`
};

export const formatResult = (allowed: boolean): string =>
  allowed ? colors.green('ALLOWED') : colors.red('DENIED');

export const flagName = (flag: number): string => {
  const names: string[] = [];
  if (flag & Flags.READ) {
    names.push('READ');
  }
  if (flag & Flags.WRITE) {
    names.push('WRITE');
  }
  if (flag & Flags.CREATE) {
    names.push('CREATE');
  }
  if (flag & Flags.DELETE) {
    names.push('DELETE');
  }
  if (flag & Flags.EXECUTE) {
    names.push('EXECUTE');
  }
  return names.join(' | ') || 'NONE';
};
