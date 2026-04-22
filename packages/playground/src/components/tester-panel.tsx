import { useAtom, useAtomValue } from 'jotai';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FLAG_OPTIONS, FLAG_TOGGLE_CLASS, getFlagName, getFlagSummary } from '../helpers/flags';
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
          <div className="flex flex-col gap-1">
            <Label htmlFor="test-path">Path:</Label>
            <Input
              id="test-path"
              list="path-suggestions"
              onChange={e => setPath(e.target.value)}
              placeholder="/path/to/resource"
              value={path}
            />
            <datalist id="path-suggestions">
              {suggestedPaths.map(p => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>

          <div
            aria-label="Permission flags"
            className="flag-toggles"
            role="group"
          >
            {FLAG_OPTIONS.map(({ flag, key, label }) => (
              <label className={FLAG_TOGGLE_CLASS} key={flag}>
                <Checkbox
                  checked={(flags & flag) === flag}
                  onCheckedChange={() => toggleFlag(flag)}
                />
                <span>{label}</span>
                <kbd className="text-xs opacity-50">({key})</kbd>
              </label>
            ))}
          </div>

          <Button disabled={!path || flags === 0} onClick={runTest} size="sm">
            Test
          </Button>
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
            <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600 }}>History</h3>
            <Button
              onClick={() => setShowHistory(!showHistory)}
              size="xs"
              variant="ghost"
            >
              {showHistory ? 'Hide' : 'Show'}
            </Button>
          </header>

          {showHistory && history.length > 0 && (
            <ScrollArea className="h-48 rounded border border-white/10">
              {history.map(entry => (
                <button
                  className={`w-full text-left flex justify-between items-center px-2 py-1.5 text-xs border-b border-white/5 last:border-0 cursor-pointer hover:bg-white/5 ${entry.allowed ? 'bg-green-500/4' : 'bg-red-500/4'}`}
                  key={entry.id}
                  onClick={() => {
                    setPath(entry.path);
                    setFlags(entry.flags);
                  }}
                >
                  <span className="truncate">
                    {entry.allowed ? '✓' : '✗'} {entry.path}
                  </span>
                  <span className="opacity-40 shrink-0 ml-2">
                    {getFlagSummary(entry.flags)}
                  </span>
                </button>
              ))}
            </ScrollArea>
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
