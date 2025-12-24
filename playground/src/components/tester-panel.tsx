import { useAtom, useAtomValue } from 'jotai';
import { useMemo, useState } from 'react';

import { Flags } from '@/index';

import {
  configAtom,
  testFlagsAtom,
  testHistoryAtom,
  testPathAtom,
  testResultAtom,
  type ExplainResult,
  type TestHistoryEntry
} from '../store/atoms';
import { TimeSimulator } from './time-simulator';

const FLAG_OPTIONS = [
  { flag: Flags.READ, key: 'r', label: 'Read' },
  { flag: Flags.WRITE, key: 'w', label: 'Write' },
  { flag: Flags.CREATE, key: 'c', label: 'Create' },
  { flag: Flags.DELETE, key: 'd', label: 'Delete' },
  { flag: Flags.EXECUTE, key: 'x', label: 'Execute' }
];

export const TesterPanel = () => {
  const [path, setPath] = useAtom(testPathAtom);
  const [flags, setFlags] = useAtom(testFlagsAtom);
  const result = useAtomValue(testResultAtom);
  const [history, setHistory] = useAtom(testHistoryAtom);
  const config = useAtomValue(configAtom);
  const [showHistory, setShowHistory] = useState(true);

  const toggleFlag = (flag: number) => {
    setFlags(current => current ^ flag);
  };

  const runTest = () => {
    if (!path || flags === 0) {
      return;
    }

    const entry: TestHistoryEntry = {
      allowed: result?.allowed ?? false,
      flags,
      id: crypto.randomUUID(),
      path,
      timestamp: new Date()
    };
    setHistory(prev => [entry, ...prev].slice(0, 20));
  };

  // Extract paths for autocomplete
  const suggestedPaths = useMemo(() => {
    const paths = new Set<string>();
    config.roles.forEach(role => {
      role.rights?.forEach(right => {
        if (typeof right === 'string') {
          return;
        }
        if (right.path) {
          paths.add(right.path.replace(/\/\*\*$/, '').replace(/\/\*$/, ''));
        }
      });
    });
    config.subject.rights?.forEach(right => {
      if (typeof right === 'string') {
        return;
      }
      if (right.path) {
        paths.add(right.path.replace(/\/\*\*$/, '').replace(/\/\*$/, ''));
      }
    });
    return Array.from(paths).sort();
  }, [config]);

  return (
    <section className="panel tester-panel">
      <header className="panel-header">
        <h2>Permission Tester</h2>
      </header>

      <div className="panel-content">
        <div className="test-inputs">
          <label htmlFor="test-path">Path:</label>
          <input
            id="test-path"
            list="path-suggestions"
            onChange={e => setPath(e.target.value)}
            placeholder="/path/to/resource"
            style={{ marginBottom: '12px', marginTop: '4px', width: '100%' }}
            type="text"
            value={path}
          />
          <datalist id="path-suggestions">
            {suggestedPaths.map(p => (
              <option key={p} value={p} />
            ))}
          </datalist>

          <div
            aria-label="Permission flags"
            className="flag-toggles"
            role="group"
          >
            {FLAG_OPTIONS.map(({ flag, key, label }) => (
              <label className="flag-toggle" key={flag}>
                <input
                  checked={(flags & flag) === flag}
                  onChange={() => toggleFlag(flag)}
                  type="checkbox"
                />
                <span>{label}</span>
                <kbd style={{ fontSize: '0.8rem', opacity: 0.6 }}>({key})</kbd>
              </label>
            ))}
          </div>

          <button disabled={!path || flags === 0} onClick={runTest}>
            Test
          </button>
        </div>

        <div aria-live="polite">
          {result && <TestResultDisplay result={result} />}
        </div>

        <TimeSimulator />

        <div className="test-history" style={{ marginTop: '1rem' }}>
          <header
            style={{
              alignItems: 'center',
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: '8px'
            }}
          >
            <h3>History</h3>
            <button
              onClick={() => setShowHistory(!showHistory)}
              style={{ fontSize: '0.8rem', padding: '2px 8px' }}
            >
              {showHistory ? 'Hide' : 'Show'}
            </button>
          </header>

          {showHistory && history.length > 0 && (
            <ul
              style={{
                border: '1px solid #eee',
                borderRadius: '4px',
                fontSize: '0.85rem',
                listStyle: 'none',
                margin: 0,
                maxHeight: '200px',
                overflowY: 'auto',
                padding: 0
              }}
            >
              {history.map(entry => (
                <li
                  key={entry.id}
                  onClick={() => {
                    setPath(entry.path);
                    setFlags(entry.flags);
                  }}
                  style={{
                    backgroundColor: entry.allowed
                      ? 'rgba(0, 255, 0, 0.05)'
                      : 'rgba(255, 0, 0, 0.05)',
                    borderBottom: '1px solid #eee',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '4px 8px'
                  }}
                >
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {entry.allowed ? '✓' : '✗'} {entry.path}
                  </span>
                  <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>
                    {getFlagSummary(entry.flags)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {showHistory && history.length === 0 && (
            <div
              style={{
                fontSize: '0.85rem',
                opacity: 0.5,
                padding: '1rem',
                textAlign: 'center'
              }}
            >
              No history yet
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

const getFlagSummary = (flags: number): string => {
  const res = [];
  if (flags & Flags.READ) {
    res.push('R');
  }
  if (flags & Flags.WRITE) {
    res.push('W');
  }
  if (flags & Flags.CREATE) {
    res.push('C');
  }
  if (flags & Flags.DELETE) {
    res.push('D');
  }
  if (flags & Flags.EXECUTE) {
    res.push('X');
  }
  return res.join('');
};

const TestResultDisplay = ({ result }: { result: ExplainResult }) => (
  <div className={`test-result ${result.allowed ? 'allowed' : 'denied'}`}>
    <div
      className="result-header"
      style={{ fontWeight: 'bold', marginBottom: '8px' }}
    >
      Result: {result.allowed ? '✓ ALLOWED' : '✗ DENIED'}
    </div>

    <div className="explanation">
      <h4>Explanation:</h4>
      {result.details.map((detail, i) => (
        <div className="detail-row" key={i}>
          <span className="flag-name">{getFlagName(detail.bit)}</span>
          <span className={detail.allowed ? 'success' : 'error'}>
            {detail.allowed ? '✓' : '✗'}
          </span>
          {detail.right && (
            <span className="matched-rule" style={{ opacity: 0.8 }}>
              {detail.right.toString()}
              {detail.source &&
                ` (${detail.source.type}${detail.source.name ? ':' + detail.source.name : ''})`}
            </span>
          )}
        </div>
      ))}
    </div>
  </div>
);

const getFlagName = (bit: number): string => {
  switch (bit) {
    case Flags.READ:
      return 'READ';
    case Flags.WRITE:
      return 'WRITE';
    case Flags.CREATE:
      return 'CREATE';
    case Flags.DELETE:
      return 'DELETE';
    case Flags.EXECUTE:
      return 'EXECUTE';
    default:
      return bit.toString();
  }
};
