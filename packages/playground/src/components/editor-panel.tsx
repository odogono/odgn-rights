/* eslint-disable no-console */
import { useAtom, useAtomValue } from 'jotai';
import { Rights } from 'odgn-rights';
import { useEffect, useRef } from 'react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  parsePlaygroundConfig,
  serializePlaygroundConfig
} from '../helpers/playground-config';
import {
  editorContentAtom,
  editorFormatAtom,
  validationErrorAtom,
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

  useEffect(() => {
    if (format === 'json') {
      const newContent = serializePlaygroundConfig(config);
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
      let parsed;
      if (format === 'json') {
        parsed = parsePlaygroundConfig(content);
      } else {
        const rights = Rights.parse(content);
        parsed = {
          resources: [],
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
          <label htmlFor="editor-format" style={{ fontSize: '0.8rem', opacity: 0.7 }}>
            Format:
          </label>
          <Select
            onValueChange={v => setFormat(v as 'json' | 'string')}
            value={format}
          >
            <SelectTrigger className="h-7 text-xs w-[130px]" id="editor-format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="json">JSON</SelectItem>
              <SelectItem value="string">Rights String</SelectItem>
            </SelectContent>
          </Select>
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
              ? 'Enter JSON config with roles, subject, and resources...'
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
            <span className="error" style={{ fontSize: '0.85rem' }}>{error}</span>
          ) : (
            <span className="success" style={{ fontSize: '0.85rem' }}>Valid configuration</span>
          )}
        </div>
        <Button disabled={!!error || !content} onClick={handleApply} size="sm">
          Apply Changes
        </Button>
      </footer>
    </section>
  );
};
