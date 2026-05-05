import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { Flags, type Subject } from 'odgn-rights';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
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
  addResourceNode,
  buildResourceDisplayTree,
  cycleRoleFlag,
  deleteResourceBranch,
  getEffectiveRoleFlagState,
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
  const [addRootOpen, setAddRootOpen] = useState(false);
  const [addRootName, setAddRootName] = useState('');
  const [addChildOpen, setAddChildOpen] = useState(false);
  const [addChildParentPath, setAddChildParentPath] = useState<string | null>(null);
  const [addChildName, setAddChildName] = useState('');
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameNode, setRenameNode] = useState<ResourceDisplayNode | null>(null);
  const [renameName, setRenameName] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteNode, setDeleteNode] = useState<ResourceDisplayNode | null>(null);

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
          getEffectiveRoleFlagState(config, selectedRole, node.path, flag)
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

  const withMutationHandling = (run: () => void) => {
    try {
      run();
    } catch (error) {
      // Surface error to user — could use a toast here in future
      console.error((error as Error).message);
    }
  };

  const handleAddRoot = () => {
    setAddRootName('');
    setAddRootOpen(true);
  };

  const handleAddRootConfirm = () => {
    const nextName = addRootName.trim();
    if (!nextName) return;
    setAddRootOpen(false);
    withMutationHandling(() => {
      syncEditorAndConfig(addResourceNode(config, null, nextName));
    });
  };

  const handleAddChild = (path: string) => {
    setAddChildName('');
    setAddChildParentPath(path);
    setAddChildOpen(true);
  };

  const handleAddChildConfirm = () => {
    const nextName = addChildName.trim();
    if (!nextName || !addChildParentPath) return;
    setAddChildOpen(false);
    withMutationHandling(() => {
      syncEditorAndConfig(addResourceNode(config, addChildParentPath, nextName));
    });
  };

  const handleRename = (node: ResourceDisplayNode) => {
    if (!selectedRole) return;
    setRenameName(node.name);
    setRenameNode(node);
    setRenameOpen(true);
  };

  const handleRenameConfirm = () => {
    if (!renameNode || !selectedRole) return;
    const nextName = renameName.trim();
    if (!nextName || nextName === renameNode.name) {
      setRenameOpen(false);
      return;
    }
    setRenameOpen(false);
    withMutationHandling(() => {
      const nextConfig = renameResourceBranch(
        config,
        selectedRole,
        renameNode.path,
        nextName
      );
      const pathParts = renameNode.path.split('/').filter(Boolean).slice(0, -1);
      const nextPath = `/${[...pathParts, nextName].join('/')}`;
      setSelectedPath(nextPath);
      syncEditorAndConfig(nextConfig);
    });
  };

  const handleDelete = (node: ResourceDisplayNode) => {
    if (!selectedRole) return;
    setDeleteNode(node);
    setDeleteOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (!deleteNode || !selectedRole) return;
    setDeleteOpen(false);
    withMutationHandling(() => {
      if (selectedPath === deleteNode.path) {
        setSelectedPath(null);
      }
      syncEditorAndConfig(deleteResourceBranch(config, selectedRole, deleteNode.path));
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
            <div className="resource-role-picker">
              <span>Edit role</span>
              <Select
                disabled={editableRoles.length === 0}
                onValueChange={v => setSelectedRole(v || null)}
                value={selectedRole ?? ''}
              >
                <SelectTrigger aria-label="Editable role" className="h-7 text-xs w-[130px]">
                  <SelectValue placeholder="No role" />
                </SelectTrigger>
                <SelectContent>
                  {editableRoles.map(roleName => (
                    <SelectItem key={roleName} value={roleName}>
                      {roleName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              disabled={!!validationError || format !== 'json'}
              onClick={handleAddRoot}
              size="sm"
              variant="outline"
            >
              Add Root
            </Button>
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
              <span className="error" style={{ fontSize: '0.85rem' }}>{validationError}</span>
            ) : (
              <span className="success" style={{ fontSize: '0.85rem' }}>Config is valid and synced</span>
            )}
          </div>
        </footer>
      </section>
      <Dialog onOpenChange={setAddRootOpen} open={addRootOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add root resource</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            onChange={e => setAddRootName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddRootConfirm()}
            placeholder="Resource name"
            value={addRootName}
          />
          <DialogFooter>
            <Button onClick={() => setAddRootOpen(false)} variant="outline">
              Cancel
            </Button>
            <Button disabled={!addRootName.trim()} onClick={handleAddRootConfirm}>
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setAddChildOpen} open={addChildOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add child resource</DialogTitle>
            {addChildParentPath && (
              <DialogDescription>
                Under <code>{addChildParentPath}</code>
              </DialogDescription>
            )}
          </DialogHeader>
          <Input
            autoFocus
            onChange={e => setAddChildName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddChildConfirm()}
            placeholder="Resource name"
            value={addChildName}
          />
          <DialogFooter>
            <Button onClick={() => setAddChildOpen(false)} variant="outline">
              Cancel
            </Button>
            <Button disabled={!addChildName.trim()} onClick={handleAddChildConfirm}>
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setRenameOpen} open={renameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename resource</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            onChange={e => setRenameName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleRenameConfirm()}
            placeholder="Resource name"
            value={renameName}
          />
          <DialogFooter>
            <Button onClick={() => setRenameOpen(false)} variant="outline">
              Cancel
            </Button>
            <Button
              disabled={!renameName.trim() || renameName.trim() === renameNode?.name}
              onClick={handleRenameConfirm}
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setDeleteOpen} open={deleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete resource</DialogTitle>
            <DialogDescription>
              Delete <code>{deleteNode?.path}</code> and remove all rights for
              the selected role below it? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setDeleteOpen(false)} variant="outline">
              Cancel
            </Button>
            <Button onClick={handleDeleteConfirm} variant="destructive">
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                disabled={structuralDisabled && disabled}
                onClick={event => event.stopPropagation()}
                size="icon-xs"
                title="Node actions"
                variant="ghost"
              >
                ⋯
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={structuralDisabled}
                onSelect={() => onAddChild(node.path)}
              >
                Add child
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={disabled}
                onSelect={() => onRename(node)}
              >
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                disabled={disabled}
                onSelect={() => onDelete(node)}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
