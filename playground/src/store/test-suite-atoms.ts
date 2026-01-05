// playground/src/store/test-suite-atoms.ts
import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

import type {
  TestResult,
  TestRunSummary,
  TestSuite
} from '../types/test-suite';

// Current test suite
export const testSuiteAtom = atomWithStorage<TestSuite | null>(
  'playground-test-suite',
  null
);

// Test suite library (multiple saved suites)
export const testSuiteLibraryAtom = atomWithStorage<TestSuite[]>(
  'playground-test-suites',
  []
);

// Currently running tests
export const isRunningTestsAtom = atom<boolean>(false);

// Last run results
export const testResultsAtom = atom<TestRunSummary | null>(null);

// Filter for viewing results
export const testFilterAtom = atom<'all' | 'passed' | 'failed'>('all');

// Selected test for detailed view
export const selectedTestResultAtom = atom<TestResult | null>(null);

// Derived: filtered results
export const filteredResultsAtom = atom(get => {
  const results = get(testResultsAtom);
  const filter = get(testFilterAtom);

  if (!results) {
    return [];
  }

  switch (filter) {
    case 'passed':
      return results.results.filter(r => r.passed);
    case 'failed':
      return results.results.filter(r => !r.passed);
    default:
      return results.results;
  }
});
