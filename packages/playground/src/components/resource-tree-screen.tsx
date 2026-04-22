/* eslint-disable no-alert */
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { Flags, type Subject } from 'odgn-rights';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  parsePlaygroundConfig,
  serializePlaygroundConfig
} from '../helpers/playground-config';
import {
  addResourceNode,
  buildResourceDisplayTree,
  cycleRoleFlag,
  deleteResourceBranch,
  getExactRoleFlagState,
  getFlagDetails,
  getOverallAccessState,
  getReferencedPaths,
  renameResourceBranch,
  RESOURCE_FLAGS,
  type EffectiveAccessState,
  type ExactFlagState,
  type ResourceDisplayNode,
  type ResourceFlagDetail
} from '../helpers/resource-tree';
import { getFlagName, getFlagSummary } from '../helpers/flags';
import {
  configAtom,
  editableResourceRolesAtom,
  editorContentAtom,
  editorFormatAtom,
  selectedResourceRoleAtom,
  subjectAtom,
  validationErrorAtom
} from '../store/atoms';
import { configWithHistoryAtom } from '../store/history';

type NodeSnapshot = {
  chipStates: Map<Flags, ExactFlagState>;
  details: ResourceFlagDetail[];
  overallState: EffectiveAccessState;
};

export const ResourceTreeScreen = () => {
  const config = useAtomValue(configAtom);
  const subject = useAtomValue(subjectAtom);
  const validationError = useAtomValue(validationErrorAtom);
  const editableRoles = useAtomValue(editableResourceRolesAtom);
  const [selectedRole, setSelectedRole] = useAtom(selectedResourceRoleAtom);
  const [content, setContent] = useAtom(editorContentAtom);
  const [format, setFormat] = useAtom(editorFormatAtom);
  const setConfig = useSetAtom(configAtom);
  const commitConfig = useSetAtom(configWithHistoryAtom);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const skipConfigSyncRef = useRef(false);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);

  useEffect(() => {
    if (format !== 'json') {
      setFormat('json');
    }
  }, [format, setFormat]);

  useEffect(() => {
    const nextContent = serializePlaygroundConfig(config);
    if (skipConfigSyncRef.current) {
      skipConfigSyncRef.current = false;
      return;
    }
    if (nextContent !== content) {
      setContent(nextContent);
    }
  }, [config, content, setContent]);

  const handleScroll = () => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  const displayTree = useMemo(
    () => buildResourceDisplayTree(config.resources, getReferencedPaths(subject)),
    [config.resources, subject]
  );

  const nodeSnapshots = useMemo(() => {
    const snapshots = new Map<string, NodeSnapshot>();

    const walk = (node: ResourceDisplayNode) => {
      const details = getFlagDetails(subject, node.path);
      const chipStates = new Map<Flags, ExactFlagState>();

      RESOURCE_FLAGS.forEach(flag => {
        chipStates.set(
          flag,
          getExactRoleFlagState(config, selectedRole, node.path, flag)
        );
      });

      snapshots.set(node.path, {
        chipStates,
        details,
        overallState: getOverallAccessState(details)
      });

      node.children.forEach(walk);
    };

    displayTree.forEach(walk);
    return snapshots;
  }, [config, displayTree, selectedRole, subject]);

  const activePath = hoveredPath ?? selectedPath;
  const activeNodeDetails = activePath ? nodeSnapshots.get(activePath) : null;
  const treeDisabled = format !== 'json' || !!validationError || !selectedRole;
  const structuralDisabled = format !== 'json' || !!validationError;

  const syncEditorAndConfig = (nextConfig: typeof config) => {
    commitConfig(nextConfig);
    setContent(serializePlaygroundConfig(nextConfig));
  };

  const handleEditorChange = (nextValue: string) => {
    setContent(nextValue);
    try {
      const parsed = parsePlaygroundConfig(nextValue);
      skipConfigSyncRef.current = true;
      setConfig(parsed);
    } catch {
      // Keep rendering the last valid config while the draft is invalid.
    }
  };

  const promptForName = (message: string, value: string = ''): string | null => {
    const nextName = window.prompt(message, value);
    if (nextName === null) {
      return null;
    }
    return nextName.trim();
  };

  const withMutationHandling = (run: () => void) => {
    try {
      run();
    } catch (error) {
      alert((error as Error).message);
    }
  };

  const handleAddRoot = () => {
    const nextName = promptForName('New top-level resource name');
    if (!nextName) {
      return;
    }

    withMutationHandling(() => {
      syncEditorAndConfig(addResourceNode(config, null, nextName));
    });
  };

  const handleAddChild = (path: string) => {
    const nextName = promptForName('New child resource name');
    if (!nextName) {
      return;
    }

    withMutationHandling(() => {
      syncEditorAndConfig(addResourceNode(config, path, nextName));
    });
  };

  const handleRename = (node: ResourceDisplayNode) => {
    if (!selectedRole) {
      return;
    }

    const nextName = promptForName('Rename resource node', node.name);
    if (!nextName || nextName === node.name) {
      return;
    }

    withMutationHandling(() => {
      const nextConfig = renameResourceBranch(
        config,
        selectedRole,
        node.path,
        nextName
      );
      const pathParts = node.path.split('/').filter(Boolean).slice(0, -1);
      const nextPath = `/${[...pathParts, nextName].join('/')}`;
      setSelectedPath(nextPath);
      syncEditorAndConfig(nextConfig);
    });
  };

  const handleDelete = (node: ResourceDisplayNode) => {
    if (!selectedRole) {
      return;
    }
    const confirmed = window.confirm(
      `Delete ${node.path} and remove selected-role rights below it?`
    );
    if (!confirmed) {
      return;
    }

    withMutationHandling(() => {
      if (selectedPath === node.path) {
        setSelectedPath(null);
      }
      syncEditorAndConfig(deleteResourceBranch(config, selectedRole, node.path));
    });
  };

  const handleToggleFlag = (path: string, flag: Flags) => {
    if (!selectedRole || treeDisabled) {
      return;
    }

    syncEditorAndConfig(cycleRoleFlag(config, selectedRole, path, flag));
  };

  const roleHint = selectedRole
    ? `Editing exact-path rights on role "${selectedRole}".`
    : 'Assign the subject to at least one defined role to enable edits.';

  return (
    <div className="resource-screen">
      <section className="panel resource-tree-panel">
        <header className="panel-header">
          <div>
            <h2>Resource Tree</h2>
            <div className="resource-screen-subtitle">
              Full-subject access with exact-path edits for the selected role
            </div>
          </div>
          <div className="resource-tree-controls">
            <label className="resource-role-picker">
              <span>Edit role</span>
              <select
                aria-label="Editable role"
                onChange={e => setSelectedRole(e.target.value || null)}
                value={selectedRole ?? ''}
              >
                {editableRoles.length === 0 && <option value="">No role</option>}
                {editableRoles.map(roleName => (
                  <option key={roleName} value={roleName}>
                    {roleName}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={!!validationError || format !== 'json'}
              onClick={handleAddRoot}
            >
              Add Root
            </button>
          </div>
        </header>

        <div className="resource-tree-body">
          <div className="resource-tree-note">{roleHint}</div>

          {validationError && (
            <div className="resource-tree-warning">
              Fix the JSON editor before changing the tree.
            </div>
          )}

          <div aria-label="Resource hierarchy" className="tree-view" role="tree">
            {displayTree.length === 0 && (
              <div className="empty-msg">
                No resources yet. Add a root node or define rights that infer
                paths.
              </div>
            )}

            {displayTree.map(node => (
              <ResourceTreeNode
                disabled={treeDisabled}
                key={node.path}
                node={node}
                nodeSnapshots={nodeSnapshots}
                onAddChild={handleAddChild}
                onDelete={handleDelete}
                onHoverPathChange={setHoveredPath}
                onRename={handleRename}
                onSelectPath={setSelectedPath}
                onToggleFlag={handleToggleFlag}
                selectedPath={selectedPath}
                structuralDisabled={structuralDisabled}
              />
            ))}
          </div>
        </div>

        <footer className="resource-details-panel">
          <h3>Node Details</h3>
          {!activePath && (
            <div className="empty-msg">
              Hover or select a node to inspect effective access.
            </div>
          )}
          {activePath && activeNodeDetails && (
            <ResourceNodeDetails
              details={activeNodeDetails.details}
              path={activePath}
              selectedRole={selectedRole}
              subject={subject}
            />
          )}
        </footer>
      </section>

      <section className="panel editor-panel">
        <header className="panel-header">
          <div>
            <h2>Config JSON</h2>
            <div className="resource-screen-subtitle">
              Live editor for roles, subject, and resources
            </div>
          </div>
        </header>

        <div className="editor-panel-content">
          <div className="line-numbers" ref={lineNumbersRef}>
            {content.split('\n').map((_, index) => (
              <div key={index}>{index + 1}</div>
            ))}
          </div>
          <textarea
            aria-label="Resource tree JSON editor"
            className={`editor-textarea ${validationError ? 'has-error' : ''}`}
            onChange={e => handleEditorChange(e.target.value)}
            onScroll={handleScroll}
            ref={textareaRef}
            spellCheck={false}
            value={content}
            wrap="off"
          />
        </div>

        <footer className="panel-footer">
          <div aria-live="polite">
            {validationError ? (
              <span className="error">{validationError}</span>
            ) : (
              <span className="success">Config is valid and synced</span>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
};

const ResourceTreeNode = ({
  depth = 0,
  disabled,
  node,
  nodeSnapshots,
  onAddChild,
  onDelete,
  onHoverPathChange,
  onRename,
  onSelectPath,
  onToggleFlag,
  selectedPath,
  structuralDisabled
}: {
  depth?: number;
  disabled: boolean;
  node: ResourceDisplayNode;
  nodeSnapshots: Map<string, NodeSnapshot>;
  onAddChild: (path: string) => void;
  onDelete: (node: ResourceDisplayNode) => void;
  onHoverPathChange: (path: string | null) => void;
  onRename: (node: ResourceDisplayNode) => void;
  onSelectPath: (path: string | null) => void;
  onToggleFlag: (path: string, flag: Flags) => void;
  selectedPath: string | null;
  structuralDisabled: boolean;
}) => {
  const [expanded, setExpanded] = useState(true);
  const isSelected = selectedPath === node.path;
  const snapshot = nodeSnapshots.get(node.path);

  return (
    <div className="resource-tree-node" role="none">
      <div
        aria-expanded={node.children.length > 0 ? expanded : undefined}
        aria-selected={isSelected}
        className={`resource-node-row state-${snapshot?.overallState ?? 'implicit'} ${isSelected ? 'selected' : ''}`}
        onClick={() => onSelectPath(node.path)}
        onMouseEnter={() => onHoverPathChange(node.path)}
        onMouseLeave={() => onHoverPathChange(null)}
        role="treeitem"
        style={{ paddingLeft: depth * 14 }}
        tabIndex={0}
      >
        {node.children.length > 0 ? (
          <button
            aria-label={expanded ? 'Collapse resource node' : 'Expand resource node'}
            className="expand-toggle"
            onClick={event => {
              event.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            {expanded ? '▼' : '▶'}
          </button>
        ) : (
          <span className="expand-placeholder" />
        )}

        <span className="node-label">{node.name}</span>
        {node.inferred && <span className="inferred-badge">inferred</span>}

        <div className="resource-chip-row">
          {RESOURCE_FLAGS.map(flag => {
            const chipState = snapshot?.chipStates.get(flag) ?? 'clear';

            return (
              <button
                className={`resource-chip chip-${chipState}`}
                disabled={disabled}
                key={flag}
                onClick={event => {
                  event.stopPropagation();
                  onToggleFlag(node.path, flag);
                }}
                title={`${getFlagName(flag)} on ${node.path}`}
              >
                {getFlagSummary(flag)}
              </button>
            );
          })}
        </div>

        <div className="resource-node-actions">
          <button
            disabled={structuralDisabled}
            onClick={event => {
              event.stopPropagation();
              onAddChild(node.path);
            }}
            title="Add child"
          >
            +
          </button>
          <button
            disabled={disabled}
            onClick={event => {
              event.stopPropagation();
              onRename(node);
            }}
            title="Rename"
          >
            Rename
          </button>
          <button
            disabled={disabled}
            onClick={event => {
              event.stopPropagation();
              onDelete(node);
            }}
            title="Delete"
          >
            Delete
          </button>
        </div>
      </div>

      {expanded &&
        node.children.map(child => (
          <ResourceTreeNode
            depth={depth + 1}
            disabled={disabled}
            key={child.path}
            node={child}
            nodeSnapshots={nodeSnapshots}
            onAddChild={onAddChild}
            onDelete={onDelete}
            onHoverPathChange={onHoverPathChange}
            onRename={onRename}
            onSelectPath={onSelectPath}
            onToggleFlag={onToggleFlag}
            selectedPath={selectedPath}
            structuralDisabled={structuralDisabled}
          />
        ))}
    </div>
  );
};

const ResourceNodeDetails = ({
  details,
  path,
  selectedRole,
  subject
}: {
  details: ResourceFlagDetail[];
  path: string;
  selectedRole: string | null;
  subject: Subject;
}) => (
  <div className="resource-node-details">
    <div className="resource-node-path">{path}</div>
    <div className="resource-detail-grid">
      {details.map(detail => {
        const sourceLabel = detail.source
          ? detail.source.type === 'direct'
            ? 'direct subject right'
            : detail.source.name === selectedRole
              ? `role:${detail.source.name} (selected role)`
              : `role:${detail.source.name}`
          : 'no matching rule';

        return (
          <div className="resource-detail-card" key={detail.flag}>
            <div className="resource-detail-header">
              <span>{getFlagName(detail.flag)}</span>
              <span className={`detail-state state-${detail.state}`}>
                {detail.state}
              </span>
            </div>
            <div className="resource-detail-source">{sourceLabel}</div>
            <div className="resource-detail-rule">
              {detail.matchedRight ?? `No matching ${getFlagName(detail.flag)} rule`}
            </div>
          </div>
        );
      })}
    </div>
    <div className="resource-detail-summary">
      Subject has {subject.allRights().length} aggregated rights in this view.
    </div>
  </div>
);
