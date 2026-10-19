import { describe, expect, it } from 'vitest';
import { canEditRules, RULES_ADMIN_ONLY } from './permissions';

describe('规则编辑权限', () => {
  it('系统管理员始终具备编辑权限', () => {
    expect(canEditRules('admin')).toBe(true);
  });

  it('普通用户权限由 RULES_ADMIN_ONLY 决定（当前阶段可编辑）', () => {
    expect(canEditRules('user')).toBe(!RULES_ADMIN_ONLY);
  });
});
