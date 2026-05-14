import { describe, expect, it } from 'bun:test';

import {
  normalizePlaygroundConfig,
  parsePlaygroundConfig
} from '../playground-config';

describe('playground config parsing', () => {
  it('fills in missing resources with an empty array', () => {
    const parsed = normalizePlaygroundConfig({
      roles: [],
      subject: { roles: ['viewer'] }
    });

    expect(parsed.resources).toEqual([]);
    expect(parsed.subject.roles).toEqual(['viewer']);
    expect(parsed.subject.rights).toEqual([]);
  });

  it('rejects duplicate sibling resource names', () => {
    expect(() =>
      normalizePlaygroundConfig({
        resources: [{ name: 'workbench' }, { name: 'workbench' }],
        roles: [],
        subject: {}
      })
    ).toThrow(/Duplicate resource name "workbench"/);
  });

  it('surfaces missing inherited roles during parsing', () => {
    expect(() =>
      parsePlaygroundConfig(
        JSON.stringify({
          resources: [],
          roles: [{ inherits: ['missing'], name: 'child', rights: [] }],
          subject: { roles: ['child'] }
        })
      )
    ).toThrow(/inherits from missing role missing/);
  });
});
