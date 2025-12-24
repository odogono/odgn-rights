// playground/src/types/test-suite.ts

export type TestCase = {
  /** Optional condition context */
  context?: Record<string, unknown>;
  /** Human-readable description */
  description?: string;
  /** Expected result: true = should be allowed, false = should be denied */
  expected: boolean;
  /** Permission flags to check (bitmask or flag names) */
  flags: number;
  /** Unique identifier for the test */
  id: string;
  /** Resource path to test */
  path: string;
  /** Optional simulated time for time-based rights */
  simulatedTime?: string; // ISO 8601
  /** Tags for filtering/grouping tests */
  tags?: string[];
};

export type TestResult = {
  actual: boolean;
  /** Execution time in milliseconds */
  duration: number;
  /** Detailed explanation from subject.explain() */
  explanation: {
    allowed: boolean;
    details: Array<{
      allowed: boolean;
      bit: number;
      right?: {
        allow: string;
        deny?: string;
        path: string;
      };
      source?: { name?: string; type: 'direct' | 'role' };
    }>;
  };
  passed: boolean;
  testCase: TestCase;
};

export type TestSuite = {
  /** Creation timestamp */
  createdAt: string;
  /** Suite description */
  description?: string;
  /** Suite name */
  name: string;
  /** Suite-level tags */
  tags?: string[];
  /** List of test cases */
  tests: TestCase[];
  /** Last modified timestamp */
  updatedAt: string;
};

export type TestRunSummary = {
  duration: number;
  failed: number;
  passed: number;
  results: TestResult[];
  skipped: number;
  total: number;
};
