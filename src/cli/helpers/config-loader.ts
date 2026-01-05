import { readFileSync } from 'node:fs';

import { Rights, type RightJSON } from '@/rights';

export type ConfigFormat = 'json' | 'string' | 'auto';

export const loadConfig = (
  filePath: string,
  format: ConfigFormat = 'auto'
): Rights => {
  const content = readFileSync(filePath, 'utf8');

  if (format === 'auto') {
    format = filePath.endsWith('.json') ? 'json' : 'string';
  }

  if (format === 'json') {
    const data = JSON.parse(content) as RightJSON[];
    return Rights.fromJSON(data);
  }

  return Rights.parse(content);
};
