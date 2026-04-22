import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DatetimeInput } from '@/components/ui/datetime-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { FLAG_OPTIONS, FLAG_TOGGLE_CLASS } from '../helpers/flags';
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
      <h3 className="font-semibold mb-3">{testCase?.id ? 'Edit Test Case' : 'New Test Case'}</h3>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="tc-path">Path:</Label>
          <Input
            id="tc-path"
            onChange={e => setPath(e.target.value)}
            placeholder="/path/to/resource"
            value={path}
          />
        </div>

        <div className="flag-toggles">
          {FLAG_OPTIONS.map(({ flag, label }) => (
            <label className={FLAG_TOGGLE_CLASS} key={flag}>
              <Checkbox
                checked={(flags & flag) === flag}
                onCheckedChange={() => toggleFlag(flag)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <Label>Expected Result:</Label>
          <Select
            onValueChange={v => setExpected(v === 'allow')}
            value={expected ? 'allow' : 'deny'}
          >
            <SelectTrigger className="h-8 text-xs w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="allow">Allow</SelectItem>
              <SelectItem value="deny">Deny</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="tc-desc">Description (optional):</Label>
          <Input
            id="tc-desc"
            onChange={e => setDescription(e.target.value)}
            placeholder="e.g. Admin can read everything"
            value={description}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="tc-time">Simulated Time (optional):</Label>
          <DatetimeInput
            id="tc-time"
            onChange={e => setSimulatedTime(e.target.value)}
            value={simulatedTime}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="tc-tags">Tags (comma separated):</Label>
          <Input
            id="tc-tags"
            onChange={e => setTags(e.target.value)}
            placeholder="admin, core, rbac"
            value={tags}
          />
        </div>

        <div className="flex gap-2 mt-2">
          <Button disabled={!path || flags === 0} onClick={handleSave} size="sm">
            Save
          </Button>
          <Button onClick={onCancel} size="sm" variant="outline">
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
};
