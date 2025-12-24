// playground/src/components/test-case-editor.tsx
import { useState } from 'react';

import { FLAG_OPTIONS } from '../helpers/flags';
import type { TestCase } from '../types/test-suite';

type TestCaseEditorProps = {
  onCancel: () => void;
  onSave: (testCase: TestCase) => void;
  testCase?: Partial<TestCase>;
};

export const TestCaseEditor = ({
  onCancel,
  onSave,
  testCase
}: TestCaseEditorProps) => {
  const [path, setPath] = useState(testCase?.path ?? '');
  const [flags, setFlags] = useState(testCase?.flags ?? 0);
  const [expected, setExpected] = useState(testCase?.expected ?? true);
  const [description, setDescription] = useState(testCase?.description ?? '');
  const [simulatedTime, setSimulatedTime] = useState(
    testCase?.simulatedTime ?? ''
  );
  const [tags, setTags] = useState(testCase?.tags?.join(', ') ?? '');

  const handleSave = () => {
    const newTestCase: TestCase = {
      description: description || undefined,
      expected,
      flags,
      id: testCase?.id ?? crypto.randomUUID(),
      path,
      simulatedTime: simulatedTime || undefined,
      tags: tags ? tags.split(',').map(t => t.trim()) : undefined
    };
    onSave(newTestCase);
  };

  const toggleFlag = (flag: number) => {
    setFlags(current => current ^ flag);
  };

  return (
    <div className="test-case-editor">
      <h3>{testCase?.id ? 'Edit Test Case' : 'New Test Case'}</h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          Path:
          <input
            onChange={e => setPath(e.target.value)}
            placeholder="/path/to/resource"
            type="text"
            value={path}
          />
        </label>

        <div className="flag-toggles">
          {FLAG_OPTIONS.map(({ flag, label }) => (
            <label className="flag-toggle" key={flag}>
              <input
                checked={(flags & flag) === flag}
                onChange={() => toggleFlag(flag)}
                type="checkbox"
              />
              <span>{label}</span>
            </label>
          ))}
        </div>

        <label style={{ alignItems: 'center', display: 'flex', gap: '8px' }}>
          Expected Result:
          <select
            onChange={e => setExpected(e.target.value === 'allow')}
            value={expected ? 'allow' : 'deny'}
          >
            <option value="allow">Allow</option>
            <option value="deny">Deny</option>
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          Description (optional):
          <input
            onChange={e => setDescription(e.target.value)}
            placeholder="e.g. Admin can read everything"
            type="text"
            value={description}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          Simulated Time (optional):
          <input
            onChange={e => setSimulatedTime(e.target.value)}
            type="datetime-local"
            value={simulatedTime}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          Tags (comma separated):
          <input
            onChange={e => setTags(e.target.value)}
            placeholder="admin, core, rbac"
            type="text"
            value={tags}
          />
        </label>

        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          <button disabled={!path || flags === 0} onClick={handleSave}>
            Save
          </button>
          <button
            className="secondary"
            onClick={onCancel}
            style={{ backgroundColor: '#444' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
