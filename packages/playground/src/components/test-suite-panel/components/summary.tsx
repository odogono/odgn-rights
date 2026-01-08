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
    summary.total > 0
      ? ((summary.passed / summary.total) * 100).toFixed(1)
      : '0';

  return (
    <div
      className="results-summary"
      style={{
        backgroundColor: '#f9f9f9',
        borderRadius: '4px',
        padding: '12px'
      }}
    >
      <div
        className="summary-stats"
        style={{
          display: 'flex',
          fontSize: '0.85rem',
          justifyContent: 'space-between',
          marginBottom: '8px'
        }}
      >
        <span className="stat total">{summary.total} total</span>
        <span className="stat passed" style={{ color: 'green' }}>
          {summary.passed} passed
        </span>
        <span className="stat failed" style={{ color: 'red' }}>
          {summary.failed} failed
        </span>
        <span className="stat duration">{summary.duration.toFixed(2)}ms</span>
      </div>

      <div
        className="progress-bar"
        style={{
          backgroundColor: '#eee',
          borderRadius: '2px',
          height: '4px',
          marginBottom: '12px',
          overflow: 'hidden'
        }}
      >
        <div
          className="progress-passed"
          style={{
            backgroundColor: 'green',
            height: '100%',
            width: `${passRate}%`
          }}
        />
      </div>

      <div className="filter-tabs" style={{ display: 'flex', gap: '4px' }}>
        {(['all', 'passed', 'failed'] as const).map(f => (
          <button
            className={filter === f ? 'active' : ''}
            key={f}
            onClick={() => onFilterChange(f)}
            style={{
              backgroundColor: filter === f ? '#666' : '#eee',
              border: 'none',
              borderRadius: '2px',
              color: filter === f ? 'white' : 'black',
              fontSize: '0.75rem',
              padding: '2px 8px',
              textTransform: 'capitalize'
            }}
          >
            {f}
          </button>
        ))}
      </div>
    </div>
  );
};
