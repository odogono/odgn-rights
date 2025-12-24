import { Right, Role, RoleRegistry, Subject } from '@/index';

export type TreeNode = {
  children: TreeNode[];
  id: string;
  label: string;
  meta?: {
    allow?: string;
    deny?: string;
    path?: string;
    source?: string;
    specificity?: number;
  };
  type: 'subject' | 'role' | 'right' | 'inherited-role';
};

export const buildTree = (
  subject: Subject,
  _registry: RoleRegistry
): TreeNode => {
  const root: TreeNode = {
    children: [],
    id: 'subject-root',
    label: 'Subject',
    type: 'subject'
  };

  // Direct Rights
  const directRightsNode: TreeNode = {
    children: subject.rights
      .allRights()
      .map((r, i) => buildRightNode(r, `direct-${i}`)),
    id: 'direct-rights',
    label: 'Direct Rights',
    type: 'subject'
  };
  if (directRightsNode.children.length > 0) {
    root.children.push(directRightsNode);
  }

  // Roles
  subject.roles.forEach((role, i) => {
    root.children.push(buildRoleNode(role, `role-${i}`));
  });

  return root;
};

const buildRoleNode = (role: Role, id: string): TreeNode => {
  const node: TreeNode = {
    children: [],
    id,
    label: `Role: ${role.name}`,
    type: 'role'
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
};

const buildRightNode = (right: Right, id: string): TreeNode => ({
  children: [],
  id,
  label: right.toString(),
  meta: {
    allow: right.allowMaskValue.toString(), // or just letters if I want to be fancy
    deny: right.denyMaskValue.toString(),
    path: right.path,
    specificity: right.specificity()
  },
  type: 'right'
});
