import { useSetAtom } from 'jotai';
import { useState } from 'react';

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
      style={{
        backgroundColor: result
          ? result.passed
            ? 'rgba(0,255,0,0.02)'
            : 'rgba(255,0,0,0.02)'
          : 'white',
        border: '1px solid #eee',
        borderRadius: '4px',
        marginBottom: '4px',
        overflow: 'hidden'
      }}
    >
      <div
        className="test-header"
        onClick={() => setExpanded(!expanded)}
        style={{
          alignItems: 'center',
          cursor: 'pointer',
          display: 'flex',
          fontSize: '0.85rem',
          padding: '8px'
        }}
      >
        <span style={{ fontWeight: 'bold', width: '20px' }}>
          {result ? (result.passed ? '✓' : '✗') : '•'}
        </span>
        <span
          style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
          title={testCase.path}
        >
          {testCase.path}
        </span>
        <span
          style={{
            fontFamily: 'monospace',
            fontSize: '0.75rem',
            margin: '0 8px',
            opacity: 0.5
          }}
        >
          {getFlagSummary(testCase.flags)}
        </span>
        <span style={{ fontSize: '0.75rem', marginRight: '8px', opacity: 0.5 }}>
          {testCase.expected ? 'allow' : 'deny'}
        </span>
        {result && (
          <span style={{ fontSize: '0.75rem', opacity: 0.5, width: '50px' }}>
            {result.duration.toFixed(1)}ms
          </span>
        )}
        <div
          onClick={e => e.stopPropagation()}
          style={{ display: 'flex', gap: '4px' }}
        >
          <button
            onClick={() => {
              setPath(testCase.path);
              setFlags(testCase.flags);
            }}
            style={{ fontSize: '0.7rem', padding: '2px 4px' }}
            title="Load into tester"
          >
            Load
          </button>
          <button
            onClick={onEdit}
            style={{ fontSize: '0.7rem', padding: '2px 4px' }}
          >
            Edit
          </button>
          <button
            onClick={onDelete}
            style={{ fontSize: '0.7rem', padding: '2px 4px' }}
          >
            Del
          </button>
        </div>
      </div>

      {expanded && (
        <div
          className="test-details"
          style={{
            backgroundColor: 'rgba(0,0,0,0.01)',
            borderTop: '1px solid #eee',
            fontSize: '0.85rem',
            padding: '8px'
          }}
        >
          {testCase.description && (
            <p
              style={{ fontStyle: 'italic', margin: '0 0 8px 0', opacity: 0.8 }}
            >
              {testCase.description}
            </p>
          )}

          {result ? (
            <div className="explanation">
              <h4 style={{ fontSize: '0.8rem', margin: '0 0 4px 0' }}>
                Explanation:
              </h4>
              {result.explanation.details.map((detail, i) => (
                <div
                  className="detail-row"
                  key={i}
                  style={{
                    display: 'flex',
                    fontSize: '0.75rem',
                    gap: '8px',
                    marginBottom: '2px'
                  }}
                >
                  <span style={{ opacity: 0.6, width: '50px' }}>
                    {getFlagName(detail.bit)}
                  </span>
                  <span style={{ color: detail.allowed ? 'green' : 'red' }}>
                    {detail.allowed ? '✓' : '✗'}
                  </span>
                  {detail.right && (
                    <span className="matched-rule" style={{ opacity: 0.8 }}>
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
            <div style={{ opacity: 0.5 }}>Run tests to see results.</div>
          )}
        </div>
      )}
    </div>
  );
};
