/**
 * 用户角色与规则编辑权限。
 *
 * 当前阶段（无后台账号体系）：允许所有用户浏览并修改规则。
 * 后续接入后台/登录态后，把 `RULES_ADMIN_ONLY` 置为 `true`，
 * 即可切换为“仅系统管理员可修改，普通用户只读”。
 */
export type UserRole = 'admin' | 'user';

/** 规则编辑是否仅限系统管理员（当前为 false：所有用户可改） */
export const RULES_ADMIN_ONLY = false;

/** 指定角色是否具备规则编辑权限 */
export function canEditRules(role: UserRole): boolean {
  return !RULES_ADMIN_ONLY || role === 'admin';
}
