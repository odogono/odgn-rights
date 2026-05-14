import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import type { TestRunSummary } from '@playground/types/test-suite';

export const TestResultsSummary = ({
  filter,
  onFilterChange,
  summary
}: {
  filter: 'all' | 'passed' | 'failed';
  onFilterChange: (f: 'all' | 'passed' | 'failed') => void;
  summary: TestRunSummary;
}) => {
  const passRate =
    summary.total > 0 ? (summary.passed / summary.total) * 100 : 0;

  return (
    <div className="results-summary rounded p-3 bg-black/20 flex flex-col gap-2">
      <div className="flex justify-between text-xs">
        <span className="opacity-60">{summary.total} total</span>
        <span className="text-[var(--success-color)]">{summary.passed} passed</span>
        <span className="text-[var(--error-color)]">{summary.failed} failed</span>
        <span className="opacity-40">{summary.duration.toFixed(2)}ms</span>
      </div>

      <Progress className="h-1.5" value={passRate} />

      <div className="flex gap-1.5">
        {(['all', 'passed', 'failed'] as const).map(f => (
          <Button
            className="flex-1 capitalize"
            key={f}
            onClick={() => onFilterChange(f)}
            size="xs"
            variant={filter === f ? 'default' : 'outline'}
          >
            {f}
          </Button>
        ))}
      </div>
    </div>
  );
};
