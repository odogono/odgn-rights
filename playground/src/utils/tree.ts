import { Right, Role, RoleRegistry, Subject } from '@/index';

export interface TreeNode {
  id: string;
  label: string;
  type: 'subject' | 'role' | 'right' | 'inherited-role';
  children: TreeNode[];
  meta?: {
    source?: string;
    specificity?: number;
    allow?: string;
    deny?: string;
    path?: string;
  };
}

export function buildTree(subject: Subject, _registry: RoleRegistry): TreeNode {
  const root: TreeNode = {
    id: 'subject-root',
    label: 'Subject',
    type: 'subject',
    children: []
  };

  // Direct Rights
  const directRightsNode: TreeNode = {
    id: 'direct-rights',
    label: 'Direct Rights',
    type: 'subject',
    children: subject.rights
      .allRights()
      .map((r, i) => buildRightNode(r, `direct-${i}`))
  };
  if (directRightsNode.children.length > 0) {
    root.children.push(directRightsNode);
  }

  // Roles
  subject.roles.forEach((role, i) => {
    root.children.push(buildRoleNode(role, `role-${i}`));
  });

  return root;
}

function buildRoleNode(role: Role, id: string): TreeNode {
  const node: TreeNode = {
    id,
    label: `Role: ${role.name}`,
    type: 'role',
    children: []
  };

  // Role Rights
  role.rights.allRights().forEach((r, i) => {
    node.children.push(buildRightNode(r, `${id}-right-${i}`));
  });

  // Inherited Roles
  role.parents.forEach((parent, i) => {
    node.children.push(buildRoleNode(parent, `${id}-parent-${i}`));
  });

  return node;
}

function buildRightNode(right: Right, id: string): TreeNode {
  return {
    id,
    label: right.toString(),
    type: 'right',
    children: [],
    meta: {
      path: right.path,
      allow: right.allowMaskValue.toString(), // or just letters if I want to be fancy
      deny: right.denyMaskValue.toString(),
      specificity: right.specificity()
    }
  };
}
