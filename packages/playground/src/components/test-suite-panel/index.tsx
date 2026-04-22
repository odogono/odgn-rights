import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TestCaseEditor } from '@playground/components/test-case-editor';
import { TestResultRow } from '@playground/components/test-suite-panel/components/row';
import { TestResultsSummary } from '@playground/components/test-suite-panel/components/summary';
import { TestRunner } from '@playground/engine/test-runner';
import { subjectAtom, testHistoryAtom } from '@playground/store/atoms';
import {
  filteredResultsAtom,
  isRunningTestsAtom,
  testFilterAtom,
  testResultsAtom,
  testSuiteAtom
} from '@playground/store/test-suite-atoms';
import type {
  TestCase,
  TestResult,
  TestSuite
} from '@playground/types/test-suite';

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
    e.target.value = '';
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
        <div className="header-actions" style={{ display: 'flex', gap: '6px' }}>
          <Button onClick={importSuite} size="xs" variant="outline">
            Import
          </Button>
          <Button disabled={!suite} onClick={exportSuite} size="xs" variant="outline">
            Export
          </Button>
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
              <Input
                className="border-0 border-b border-transparent bg-transparent p-0 text-lg font-bold rounded-none focus-visible:ring-0 focus-visible:border-b focus-visible:border-white/30 h-auto"
                onChange={e => setSuite({ ...suite, name: e.target.value })}
                value={suite.name}
              />
              <textarea
                className="w-full bg-transparent border-none resize-none text-sm opacity-60 outline-none mt-1"
                onChange={e =>
                  setSuite({ ...suite, description: e.target.value })
                }
                placeholder="Suite description..."
                value={suite.description}
              />
              <span className="text-xs opacity-40">{suite.tests.length} tests</span>
            </div>

            <div className="flex gap-2 mb-4">
              <Button
                className="flex-1 font-semibold"
                disabled={isRunning || suite.tests.length === 0}
                onClick={runAllTests}
                size="sm"
                variant="default"
              >
                {isRunning ? 'Running…' : '▶ Run All Tests'}
              </Button>

              <Button
                onClick={() => setEditingTestCase({})}
                size="sm"
                variant="outline"
              >
                + Add Test
              </Button>

              <Button
                disabled={history.length === 0}
                onClick={addTestFromHistory}
                size="sm"
                title="Add all tests from recent history"
                variant="outline"
              >
                + History
              </Button>
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
                <div className="text-center opacity-40 py-8 text-sm">
                  No tests in this suite yet.
                </div>
              )}
              {(results
                ? filteredResults
                : suite.tests.map(t => ({ testCase: t }) as TestResult)
              ).map((item: TestResult) => {
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
          <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
            <p className="opacity-60 text-sm">No test suite loaded.</p>
            <Button onClick={createNewSuite}>Create New Suite</Button>
          </div>
        )}
      </div>
    </section>
  );
};
