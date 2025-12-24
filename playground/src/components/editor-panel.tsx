import { useAtom, useAtomValue } from 'jotai';
import { useEffect, useRef } from 'react';

import { Rights } from '@/index';

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
  }, [config, format]);

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
        <select
          onChange={e => setFormat(e.target.value as 'json' | 'string')}
          value={format}
        >
          <option value="json">JSON</option>
          <option value="string">Rights String</option>
        </select>
      </header>

      <div className="editor-panel-content">
        <div className="line-numbers" ref={lineNumbersRef}>
          {content.split('\n').map((_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <textarea
          ref={textareaRef}
          className={`editor-textarea ${error ? 'has-error' : ''}`}
          onChange={e => setContent(e.target.value)}
          onScroll={handleScroll}
          placeholder={
            format === 'json'
              ? 'Enter JSON config...'
              : 'Enter rights (e.g. +r:/public/**)'
          }
          spellCheck={false}
          value={content}
          wrap="off"
        />
      </div>

      <footer className="panel-footer">
        {error ? (
          <span className="error">{error}</span>
        ) : (
          <span className="success">Valid configuration</span>
        )}
        <button disabled={!!error || !content} onClick={handleApply}>
          Apply Changes
        </button>
      </footer>
    </section>
  );
};
