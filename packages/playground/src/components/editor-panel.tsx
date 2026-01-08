/* eslint-disable no-console */
import { useAtom, useAtomValue } from 'jotai';
import { Rights } from 'odgn-rights';
import { useEffect, useRef } from 'react';

import {
  editorContentAtom,
  editorFormatAtom,
  validationErrorAtom,
  type PlaygroundConfig
} from '../store/atoms';
import { configWithHistoryAtom } from '../store/history';

export const EditorPanel = () => {
  const [content, setContent] = useAtom(editorContentAtom);
  const [format, setFormat] = useAtom(editorFormatAtom);
  const error = useAtomValue(validationErrorAtom);
  const [config, setConfig] = useAtom(configWithHistoryAtom);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  const handleScroll = () => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  useEffect(() => {
    handleScroll();
  }, [content]);

  // Sync editor content when config changes (e.g. from preset or undo/redo)
  useEffect(() => {
    if (format === 'json') {
      const newContent = JSON.stringify(config, null, 2);
      if (newContent !== content) {
        setContent(newContent);
      }
    }
  }, [config, format, content, setContent]);

  const handleApply = () => {
    if (error) {
      return;
    }
    try {
      let parsed: PlaygroundConfig;
      if (format === 'json') {
        parsed = JSON.parse(content);
      } else {
        const rights = Rights.parse(content);
        parsed = {
          roles: [],
          subject: { rights: rights.toJSON() }
        };
      }
      setConfig(parsed);
    } catch (error_) {
      console.error(error_);
    }
  };

  return (
    <section className="panel editor-panel">
      <header className="panel-header">
        <h2>Editor</h2>
        <div style={{ alignItems: 'center', display: 'flex', gap: '8px' }}>
          <label htmlFor="editor-format" style={{ fontSize: '0.8rem' }}>
            Format:
          </label>
          <select
            id="editor-format"
            onChange={e => setFormat(e.target.value as 'json' | 'string')}
            value={format}
          >
            <option value="json">JSON</option>
            <option value="string">Rights String</option>
          </select>
        </div>
      </header>

      <div className="editor-panel-content">
        <div className="line-numbers" ref={lineNumbersRef}>
          {content.split('\n').map((_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <textarea
          aria-label="Rights configuration editor"
          className={`editor-textarea ${error ? 'has-error' : ''}`}
          id="rights-editor"
          onChange={e => setContent(e.target.value)}
          onScroll={handleScroll}
          placeholder={
            format === 'json'
              ? 'Enter JSON config...'
              : 'Enter rights (e.g. +r:/public/**)'
          }
          ref={textareaRef}
          spellCheck={false}
          value={content}
          wrap="off"
        />
      </div>

      <footer className="panel-footer">
        <div aria-live="polite">
          {error ? (
            <span className="error">{error}</span>
          ) : (
            <span className="success">Valid configuration</span>
          )}
        </div>
        <button disabled={!!error || !content} onClick={handleApply}>
          Apply Changes
        </button>
      </footer>
    </section>
  );
};
