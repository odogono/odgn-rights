import { useAtom, useAtomValue } from 'jotai';
import { useMemo, useState } from 'react';

import {
  roleRegistryAtom,
  selectedNodeAtom,
  subjectAtom
} from '../store/atoms';
import { buildTree, type TreeNode } from '../utils/tree';

export function HierarchyPanel() {
  const subject = useAtomValue(subjectAtom);
  const registry = useAtomValue(roleRegistryAtom);
  const [selectedNode, setSelectedNode] = useAtom(selectedNodeAtom);

  const tree = useMemo(() => buildTree(subject, registry), [subject, registry]);

  return (
    <section className="panel hierarchy-panel">
      <header className="panel-header">
        <h2>Hierarchy</h2>
      </header>

      <div className="tree-view">
        <TreeNodeComponent
          node={tree}
          selected={selectedNode}
          onSelect={setSelectedNode}
        />
      </div>

      <div className="aggregated-rights">
        <h3>Aggregated Rights</h3>
        <div className="rights-list">
          {subject.allRights().length === 0 && (
            <div className="empty-msg">No rights defined</div>
          )}
          {subject
            .allRights()
            .sort((a, b) => b.right.specificity() - a.right.specificity())
            .map((entry, i) => (
              <div key={i} className="right-item">
                <span className="right-str">{entry.right.toString()}</span>
                {entry.source && (
                  <span className="source">
                    {entry.source.type === 'direct'
                      ? 'direct'
                      : `role:${entry.source.name}`}
                  </span>
                )}
                <span className="specificity">{entry.right.specificity()}</span>
              </div>
            ))}
        </div>
      </div>
    </section>
  );
}

function TreeNodeComponent({
  node,
  selected,
  onSelect,
  depth = 0
}: {
  node: TreeNode;
  selected: string | null;
  onSelect: (id: string) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="tree-node" style={{ paddingLeft: depth * 12 }}>
      <div
        className={`tree-node-label ${selected === node.id ? 'selected' : ''} node-type-${node.type}`}
        onClick={() => onSelect(node.id)}
      >
        {node.children.length > 0 && (
          <button
            className="expand-toggle"
            onClick={e => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            {expanded ? '▼' : '▶'}
          </button>
        )}
        <span className="node-label">{node.label}</span>
        {node.meta?.specificity !== undefined && (
          <span className="specificity" title="Specificity Score">
            {node.meta.specificity}
          </span>
        )}
      </div>

      {expanded &&
        node.children.map(child => (
          <TreeNodeComponent
            key={child.id}
            node={child}
            selected={selected}
            onSelect={onSelect}
            depth={depth + 1}
          />
        ))}
    </div>
  );
}
