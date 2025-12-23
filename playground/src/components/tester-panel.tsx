import { useAtom, useAtomValue } from 'jotai';

import { Flags } from '@/index';

import {
  testFlagsAtom,
  testHistoryAtom,
  testPathAtom,
  testResultAtom,
  type ExplainResult,
  type TestHistoryEntry
} from '../store/atoms';

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
  const [, setHistory] = useAtom(testHistoryAtom);

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

  return (
    <section className="panel tester-panel">
      <header className="panel-header">
        <h2>Permission Tester</h2>
      </header>

      <div className="panel-content">
        <div className="test-inputs">
          <label>
            Path:
            <input
              onChange={e => setPath(e.target.value)}
              placeholder="/path/to/resource"
              style={{ marginTop: '4px', width: '100%' }}
              type="text"
              value={path}
            />
          </label>

          <div className="flag-toggles">
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

        {result && <TestResultDisplay result={result} />}
      </div>
    </section>
  );
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
