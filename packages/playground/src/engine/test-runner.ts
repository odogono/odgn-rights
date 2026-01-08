// playground/src/engine/test-runner.ts
import { Flags, type Subject } from 'odgn-rights';

import type { TestCase, TestResult, TestRunSummary } from '../types/test-suite';

export class TestRunner {
  constructor(private subject: Subject) {}

  runSingle(testCase: TestCase): TestResult {
    const start = performance.now();

    const context = testCase.simulatedTime
      ? { ...testCase.context, _now: new Date(testCase.simulatedTime) }
      : testCase.context;

    const explanation = this.subject.explain(
      testCase.path,
      testCase.flags as Flags,
      context
    );

    const duration = performance.now() - start;
    const actual = explanation.allowed;
    const passed = actual === testCase.expected;

    return {
      actual,
      duration,
      explanation: {
        allowed: explanation.allowed,
        details: explanation.details.map(d => ({
          allowed: d.allowed,
          bit: d.bit,
          right: d.right
            ? {
                allow: d.right.toJSON().allow,
                deny: d.right.toJSON().deny,
                path: d.right.path
              }
            : undefined,
          source: d.source
        }))
      },
      passed,
      testCase
    };
  }

  runAll(tests: TestCase[]): TestRunSummary {
    const start = performance.now();
    const results: TestResult[] = [];

    for (const test of tests) {
      results.push(this.runSingle(test));
    }

    const duration = performance.now() - start;

    return {
      duration,
      failed: results.filter(r => !r.passed).length,
      passed: results.filter(r => r.passed).length,
      results,
      skipped: 0,
      total: tests.length
    };
  }

  runFiltered(tests: TestCase[], tags: string[]): TestRunSummary {
    const filtered = tests.filter(
      t => tags.length === 0 || t.tags?.some(tag => tags.includes(tag))
    );
    return this.runAll(filtered);
  }
}
