// playground/src/components/test-suite-panel.tsx
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useRef, useState } from 'react';

import { TestCaseEditor } from '@/playground/components/test-case-editor';
import { TestResultRow } from '@/playground/components/test-suite-panel/components/row';
import { TestResultsSummary } from '@/playground/components/test-suite-panel/components/summary';
import { TestRunner } from '@/playground/engine/test-runner';
import { subjectAtom, testHistoryAtom } from '@/playground/store/atoms';
import {
  filteredResultsAtom,
  isRunningTestsAtom,
  testFilterAtom,
  testResultsAtom,
  testSuiteAtom
} from '@/playground/store/test-suite-atoms';
import type { TestCase, TestSuite } from '@/playground/types/test-suite';

export const TestSuitePanel = () => {
  const [suite, setSuite] = useAtom(testSuiteAtom);
  const [isRunning, setIsRunning] = useAtom(isRunningTestsAtom);
  const setResults = useSetAtom(testResultsAtom);
  const subject = useAtomValue(subjectAtom);
  const results = useAtomValue(testResultsAtom);
  const [filter, setFilter] = useAtom(testFilterAtom);
  const filteredResults = useAtomValue(filteredResultsAtom);
  const history = useAtomValue(testHistoryAtom);

  const [editingTestCase, setEditingTestCase] =
    useState<Partial<TestCase> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const runAllTests = async () => {
    if (!suite) {
      return;
    }

    setIsRunning(true);

    // Run in next tick to allow UI to update
    await new Promise(resolve => setTimeout(resolve, 0));

    const runner = new TestRunner(subject);
    const summary = runner.runAll(suite.tests);

    setResults(summary);
    setIsRunning(false);
  };

  const createNewSuite = () => {
    const newSuite: TestSuite = {
      createdAt: new Date().toISOString(),
      description: 'A collection of test cases',
      name: 'New Test Suite',
      tests: [],
      updatedAt: new Date().toISOString()
    };
    setSuite(newSuite);
  };

  const addTestFromHistory = () => {
    if (!suite) {
      return;
    }
    const newTests: TestCase[] = history.map(h => ({
      description: `Imported from history at ${new Date(h.timestamp).toLocaleTimeString()}`,
      expected: h.allowed,
      flags: h.flags,
      id: crypto.randomUUID(),
      path: h.path
    }));

    setSuite({
      ...suite,
      tests: [...suite.tests, ...newTests],
      updatedAt: new Date().toISOString()
    });
  };

  const importSuite = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = event => {
      try {
        const content = event.target?.result as string;
        const imported = JSON.parse(content) as TestSuite;
        setSuite(imported);
      } catch (error) {
        alert('Failed to import test suite: ' + (error as Error).message);
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset for next time
  };

  const exportSuite = () => {
    if (!suite) {
      return;
    }
    const blob = new Blob([JSON.stringify(suite, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${suite.name.toLowerCase().replaceAll(/\s+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveTestCase = (testCase: TestCase) => {
    if (!suite) {
      return;
    }

    const existingIndex = suite.tests.findIndex(t => t.id === testCase.id);
    const newTests = [...suite.tests];

    if (existingIndex >= 0) {
      newTests[existingIndex] = testCase;
    } else {
      newTests.push(testCase);
    }

    setSuite({
      ...suite,
      tests: newTests,
      updatedAt: new Date().toISOString()
    });
    setEditingTestCase(null);
  };

  const deleteTestCase = (id: string) => {
    if (!suite) {
      return;
    }
    setSuite({
      ...suite,
      tests: suite.tests.filter(t => t.id !== id),
      updatedAt: new Date().toISOString()
    });
  };

  return (
    <section className="panel test-suite-panel">
      <header className="panel-header">
        <h2>Test Suite</h2>
        <div className="header-actions" style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={importSuite}
            style={{ fontSize: '0.8rem', padding: '2px 8px' }}
          >
            Import
          </button>
          <button
            disabled={!suite}
            onClick={exportSuite}
            style={{ fontSize: '0.8rem', padding: '2px 8px' }}
          >
            Export
          </button>
          <input
            accept=".json"
            onChange={handleFileChange}
            ref={fileInputRef}
            style={{ display: 'none' }}
            type="file"
          />
        </div>
      </header>

      <div className="panel-content">
        {editingTestCase && (
          <TestCaseEditor
            onCancel={() => setEditingTestCase(null)}
            onSave={handleSaveTestCase}
            testCase={editingTestCase}
          />
        )}

        {suite ? (
          <>
            <div className="suite-info" style={{ marginBottom: '1rem' }}>
              <input
                onBlur={e =>
                  (e.target.style.borderBottom = '1px solid transparent')
                }
                onChange={e => setSuite({ ...suite, name: e.target.value })}
                onFocus={e => (e.target.style.borderBottom = '1px solid #ccc')}
                style={{
                  border: 'none',
                  borderBottom: '1px solid transparent',
                  fontSize: '1.2rem',
                  fontWeight: 'bold',
                  width: '100%'
                }}
                type="text"
                value={suite.name}
              />
              <textarea
                onChange={e =>
                  setSuite({ ...suite, description: e.target.value })
                }
                placeholder="Suite description..."
                style={{
                  border: 'none',
                  fontSize: '0.9rem',
                  opacity: 0.7,
                  resize: 'none',
                  width: '100%'
                }}
                value={suite.description}
              />
              <span
                className="test-count"
                style={{ fontSize: '0.8rem', opacity: 0.5 }}
              >
                {suite.tests.length} tests
              </span>
            </div>

            <div
              className="suite-controls"
              style={{ display: 'flex', gap: '8px', marginBottom: '1rem' }}
            >
              <button
                className="run-all-btn"
                disabled={isRunning || suite.tests.length === 0}
                onClick={runAllTests}
                style={{ flex: 1 }}
              >
                {isRunning ? 'Running...' : '▶ Run All Tests'}
              </button>

              <button
                onClick={() => setEditingTestCase({})}
                style={{ padding: '4px 12px' }}
              >
                + Add Test
              </button>

              <button
                disabled={history.length === 0}
                onClick={addTestFromHistory}
                style={{ padding: '4px 12px' }}
                title="Add all tests from recent history"
              >
                + From History
              </button>
            </div>

            {results && (
              <TestResultsSummary
                filter={filter}
                onFilterChange={setFilter}
                summary={results}
              />
            )}

            <div className="test-list" style={{ marginTop: '1rem' }}>
              {suite.tests.length === 0 && (
                <div
                  style={{ opacity: 0.5, padding: '2rem', textAlign: 'center' }}
                >
                  No tests in this suite yet.
                </div>
              )}
              {(results
                ? filteredResults
                : suite.tests.map(t => ({ testCase: t }) as any)
              ).map((item: any) => {
                const testCase = item.testCase || item;
                const result = item.passed !== undefined ? item : null;
                return (
                  <TestResultRow
                    key={testCase.id}
                    onDelete={() => deleteTestCase(testCase.id)}
                    onEdit={() => setEditingTestCase(testCase)}
                    result={result}
                    testCase={testCase}
                  />
                );
              })}
            </div>
          </>
        ) : (
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <p style={{ marginBottom: '1rem', opacity: 0.7 }}>
              No test suite loaded.
            </p>
            <button onClick={createNewSuite}>Create New Suite</button>
          </div>
        )}
      </div>
    </section>
  );
};
