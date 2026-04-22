import { useSetAtom } from 'jotai';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { showDocAtom } from '../store/atoms';

export const DocPanel = () => {
  const setShowDoc = useSetAtom(showDocAtom);

  return (
    <Dialog onOpenChange={open => !open && setShowDoc(false)} open>
      <DialogContent aria-describedby={undefined} className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Playground Documentation</DialogTitle>
        </DialogHeader>
        <div className="doc-content">
          <section>
            <h3>Getting Started</h3>
            <p>
              Use the <strong>Editor</strong> to define roles and rights. You
              can use JSON or a shorthand string format. Click{' '}
              <strong>Apply Changes</strong> to update the visualization.
            </p>
          </section>

          <section>
            <h3>Permission Tester</h3>
            <p>
              Enter a path and toggle permission flags (<strong>R</strong>ead,{' '}
              <strong>W</strong>rite, etc.) to test if access is allowed. The{' '}
              <strong>Explanation</strong> shows which rule matched and why.
            </p>
          </section>

          <section>
            <h3>Hierarchy Visualization</h3>
            <p>
              The center panel shows the full structure of the subject,
              including inherited roles and rights. Nodes can be
              expanded/collapsed.
            </p>
          </section>

          <section>
            <h3>Shorthand Format</h3>
            <p>
              Example: <code>+rwc:/path/** -d:/path/secret</code>
            </p>
            <ul>
              <li>
                <code>+</code> or <code>allow</code>: Grant permissions
              </li>
              <li>
                <code>-</code> or <code>deny</code>: Revoke permissions
              </li>
              <li>
                Flags: <code>r</code> (read), <code>w</code> (write),{' '}
                <code>c</code> (create), <code>d</code> (delete), <code>x</code>{' '}
                (execute), <code>*</code> (all)
              </li>
              <li>
                Globs: <code>*</code> matches one segment, <code>**</code>{' '}
                matches any number of segments.
              </li>
            </ul>
          </section>

          <section>
            <h3>Keyboard Shortcuts</h3>
            <ul>
              <li>
                <kbd>Ctrl/Cmd + Z</kbd>: Undo
              </li>
              <li>
                <kbd>Ctrl/Cmd + Shift + Z</kbd>: Redo
              </li>
              <li>
                <kbd>R</kbd>, <kbd>W</kbd>, <kbd>C</kbd>, <kbd>D</kbd>,{' '}
                <kbd>X</kbd>: Toggle flags
              </li>
              <li>
                <kbd>Enter</kbd>: Run test
              </li>
            </ul>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
};
