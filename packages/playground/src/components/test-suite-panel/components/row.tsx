import { useSetAtom } from 'jotai';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { getFlagName, getFlagSummary } from '@playground/helpers/flags';
import { testFlagsAtom, testPathAtom } from '@playground/store/atoms';
import type { TestCase, TestResult } from '@playground/types/test-suite';

export const TestResultRow = ({
  onDelete,
  onEdit,
  result,
  testCase
}: {
  onDelete: () => void;
  onEdit: () => void;
  result: TestResult | null;
  testCase: TestCase;
}) => {
  const [expanded, setExpanded] = useState(false);
  const setPath = useSetAtom(testPathAtom);
  const setFlags = useSetAtom(testFlagsAtom);

  return (
    <div
      className={`test-result-row ${result ? (result.passed ? 'passed' : 'failed') : ''}`}
    >
      <div
        className="test-header"
        onClick={() => setExpanded(!expanded)}
      >
        <span style={{ fontWeight: 'bold', width: '20px' }}>
          {result ? (result.passed ? '✓' : '✗') : '•'}
        </span>
        <span
          className="flex-1 truncate"
          title={testCase.path}
        >
          {testCase.path}
        </span>
        <span className="font-mono text-xs opacity-40 mx-2">
          {getFlagSummary(testCase.flags)}
        </span>
        <span className="text-xs opacity-40 mr-2">
          {testCase.expected ? 'allow' : 'deny'}
        </span>
        {result && (
          <span className="text-xs opacity-40 w-12">
            {result.duration.toFixed(1)}ms
          </span>
        )}
        <div
          className="flex gap-1"
          onClick={e => e.stopPropagation()}
        >
          <Button
            onClick={() => {
              setPath(testCase.path);
              setFlags(testCase.flags);
            }}
            size="icon-xs"
            title="Load into tester"
            variant="ghost"
          >
            ↗
          </Button>
          <Button onClick={onEdit} size="icon-xs" variant="ghost">
            ✎
          </Button>
          <Button onClick={onDelete} size="icon-xs" variant="ghost">
            ✕
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="test-details">
          {testCase.description && (
            <p className="italic opacity-70 text-xs mb-2">{testCase.description}</p>
          )}

          {result ? (
            <div className="explanation">
              <h4 className="text-xs font-semibold mb-1">Explanation:</h4>
              {result.explanation.details.map((detail, i) => (
                <div
                  className="detail-row"
                  key={i}
                >
                  <span className="opacity-50 w-12 text-xs">{getFlagName(detail.bit)}</span>
                  <span className={detail.allowed ? 'success' : 'error'}>
                    {detail.allowed ? '✓' : '✗'}
                  </span>
                  {detail.right && (
                    <span className="matched-rule text-xs opacity-70">
                      {detail.right.allow ? `+${detail.right.allow}` : ''}
                      {detail.right.deny ? `-${detail.right.deny}` : ''}:
                      {detail.right.path}
                      {detail.source &&
                        ` (${detail.source.type}${detail.source.name ? ':' + detail.source.name : ''})`}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="opacity-40 text-xs">Run tests to see results.</div>
          )}
        </div>
      )}
    </div>
  );
};
