import { useMemo, useState } from 'react';

import { Right } from '@/index';

export function PatternSandbox() {
  const [pattern, setPattern] = useState('**/*.ts');
  const [path, setPath] = useState('src/index.ts');

  const result = useMemo(() => {
    try {
      const r = new Right(pattern);
      return {
        matches: r.matches(path),
        error: null
      };
    } catch (e) {
      return {
        matches: false,
        error: (e as Error).message
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
            type="text"
            value={pattern}
            onChange={e => setPattern(e.target.value)}
            placeholder="e.g. /public/**"
          />
        </div>
        <div className="input-group">
          <label htmlFor="path-input">Test Path:</label>
          <input
            id="path-input"
            type="text"
            value={path}
            onChange={e => setPath(e.target.value)}
            placeholder="e.g. /public/images/logo.png"
          />
        </div>
        <div
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
}
