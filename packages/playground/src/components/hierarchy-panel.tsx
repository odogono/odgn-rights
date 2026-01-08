import { useAtom, useAtomValue } from 'jotai';
import { useMemo, useState } from 'react';

import { buildTree, type TreeNode } from '../helpers/tree';
import {
  roleRegistryAtom,
  selectedNodeAtom,
  subjectAtom
} from '../store/atoms';

export const HierarchyPanel = () => {
  const subject = useAtomValue(subjectAtom);
  const registry = useAtomValue(roleRegistryAtom);
  const [selectedNode, setSelectedNode] = useAtom(selectedNodeAtom);

  const tree = useMemo(() => buildTree(subject, registry), [subject, registry]);

  return (
    <section className="panel hierarchy-panel">
      <header className="panel-header">
        <h2>Hierarchy</h2>
      </header>

      <div aria-label="Subject Hierarchy" className="tree-view" role="tree">
        <TreeNodeComponent
          node={tree}
          onSelect={setSelectedNode}
          selected={selectedNode}
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
              <div className="right-item" key={i}>
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
};

const TreeNodeComponent = ({
  depth = 0,
  node,
  onSelect,
  selected
}: {
  depth?: number;
  node: TreeNode;
  onSelect: (id: string) => void;
  selected: string | null;
}) => {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="tree-node" role="none" style={{ paddingLeft: depth * 12 }}>
      <div
        aria-expanded={node.children.length > 0 ? expanded : undefined}
        aria-selected={selected === node.id}
        className={`tree-node-label ${selected === node.id ? 'selected' : ''} node-type-${node.type}`}
        onClick={() => onSelect(node.id)}
        role="treeitem"
        tabIndex={0}
      >
        {node.children.length > 0 && (
          <button
            aria-label={expanded ? 'Collapse' : 'Expand'}
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
            depth={depth + 1}
            key={child.id}
            node={child}
            onSelect={onSelect}
            selected={selected}
          />
        ))}
    </div>
  );
};
