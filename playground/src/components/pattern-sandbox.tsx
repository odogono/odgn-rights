import { useMemo, useState } from 'react';

import { Right } from '@/index';

export const PatternSandbox = () => {
  const [pattern, setPattern] = useState('/org/open/device/**/description');
  const [path, setPath] = useState(
    '/org/open/device/product/example/device/description'
  );

  const result = useMemo(() => {
    try {
      const r = new Right(pattern);
      return {
        error: null,
        matches: r.matches(path)
      };
    } catch (error) {
      return {
        error: (error as Error).message,
        matches: false
      };
    }
  }, [pattern, path]);

  return (
    <section className="panel pattern-sandbox">
      <header className="panel-header">
        <h2>Pattern Sandbox</h2>
      </header>
      <div className="sandbox-content">
        <div className="input-group">
          <label htmlFor="pattern-input">Pattern:</label>
          <input
            id="pattern-input"
            onChange={e => setPattern(e.target.value)}
            placeholder="e.g. /public/**"
            type="text"
            value={pattern}
          />
        </div>
        <div className="input-group">
          <label htmlFor="path-input">Test Path:</label>
          <input
            id="path-input"
            onChange={e => setPath(e.target.value)}
            placeholder="e.g. /public/images/logo.png"
            type="text"
            value={path}
          />
        </div>
        <div
          aria-live="polite"
          className={`match-result ${result.matches ? 'matches' : 'no-match'}`}
        >
          {result.error ? (
            <span className="error">Error: {result.error}</span>
          ) : result.matches ? (
            <span className="success">✓ Matches!</span>
          ) : (
            <span className="failure">✗ No match</span>
          )}
        </div>
      </div>
    </section>
  );
};
