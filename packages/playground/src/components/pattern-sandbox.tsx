import { Right } from 'odgn-rights';
import { useMemo, useState } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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
          <Label htmlFor="pattern-input">Pattern:</Label>
          <Input
            id="pattern-input"
            onChange={e => setPattern(e.target.value)}
            placeholder="e.g. /public/**"
            value={pattern}
          />
        </div>
        <div className="input-group">
          <Label htmlFor="path-input">Test Path:</Label>
          <Input
            id="path-input"
            onChange={e => setPath(e.target.value)}
            placeholder="e.g. /public/images/logo.png"
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
            <span>✓ Matches!</span>
          ) : (
            <span>✗ No match</span>
          )}
        </div>
      </div>
    </section>
  );
};
