/**
 * IR → 现有 BiddingRule 的适配编译器。
 *
 * 本阶段只提供独立模块，不切换 src/store/game.ts 的运行时。
 * 编译器负责：
 * - shapeClass 降解（BAL_ANY / BAL_NO_5M）；
 * - IR 叫品 PASS → 运行时 "Pass"；
 * - 保留源 specificity 与声明顺序；
 * - 对 SEMIBAL/UNBAL 给出诊断并排除出可执行集；
 * - 对矛盾条件与同权冲突给出警告，但不静默删除或改序。
 */

import type { BiddingRule, ConditionSpec } from '../engine/types';
import type { Diagnostic, DiagnosticCode, DiagnosticSeverity, SourceLocation } from './diagnostics';
import { sortDiagnostics } from './diagnostics';
import { computeRulesetId } from './ruleset';
import type {
  CompileResult,
  CompiledRule,
  ParseOptions,
  RuleIR,
  RulesIR,
} from './types';

/** 去掉 ANY/ALL 展开的 `#n` 后缀；后缀不参与标签与源 id 语义。 */
export function sourceRuleId(id: string): string {
  return id.replace(/#\d+$/, '');
}

/** 把 IR 序列中的 PASS 转成运行时 matcher 接受的 Pass。 */
export function toRuntimeSequence(sequence: string): string {
  if (sequence === '^$' || sequence === '.*') return sequence;
  return sequence
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const match = /^([MPLR]):(.+)$/.exec(token);
      if (!match) return token;
      return `${match[1]}:${match[2] === 'PASS' ? 'Pass' : match[2]}`;
    })
    .join(' ');
}

/** 把 IR 动作 PASS 转成运行时动作 Pass；其余不变。 */
export function toRuntimeAction(action: string): string {
  return action === 'PASS' ? 'Pass' : action;
}

function sourceLocation(rule: RuleIR, index: number, options: ParseOptions): SourceLocation {
  const file = rule.source?.file ?? options.file;
  const line = rule.source?.line ?? index + 1;
  return { ...(file ? { file } : {}), line };
}

function compiledLocation(rule: CompiledRule, options: ParseOptions): SourceLocation {
  const file = rule.source?.file ?? options.file;
  const line = rule.source?.line ?? rule.sourceIndex + 1;
  return { ...(file ? { file } : {}), line };
}

/**
 * 编译 IR。
 * 输入应已通过 validateIr / parseDsl；本函数仍对 shapeClass 与歧义做语义检查。
 */
export function compileRules(ir: RulesIR, options: ParseOptions = {}): CompileResult {
  const diagnostics: Diagnostic[] = [];
  const report = (
    code: DiagnosticCode,
    severity: DiagnosticSeverity,
    message: string,
    location: SourceLocation,
    ruleId?: string,
    details?: Record<string, unknown>,
  ): void => {
    diagnostics.push({
      code,
      severity,
      message,
      location,
      ...(ruleId ? { ruleId } : {}),
      ...(details ? { details } : {}),
    });
  };

  const rules: CompiledRule[] = [];

  ir.rules.forEach((rule, index) => {
    const location = sourceLocation(rule, index, options);

    if (rule.enabled === false) {
      report('RULE_DISABLED', 'info', `规则 ${rule.id} 已禁用，不进入可执行集`, location, rule.id);
      return;
    }

    const when: Record<string, string | boolean> = { ...rule.when };
    const shape = when.shapeClass;
    delete when.shapeClass;

    if (shape !== undefined) {
      if (shape === 'SEMIBAL' || shape === 'UNBAL') {
        report(
          'UNSUPPORTED_CONDITION',
          'warning',
          `shapeClass ${shape} 在 v0.5 运行时暂不支持，规则保留在 IR 但不进入可执行集`,
          location,
          rule.id,
          { shapeClass: shape },
        );
        return;
      }
      if (shape === 'BAL_ANY') {
        if (when.balanced === false) {
          report(
            'CONTRADICTORY_CONDITION',
            'warning',
            `shapeClass BAL_ANY 与 balanced:false 矛盾；规则保留在 IR/可执行集，但条件恒不成立`,
            location,
            rule.id,
            { shapeClass: shape, balanced: false },
          );
        } else {
          when.balanced = true;
        }
      } else if (shape === 'BAL_NO_5M') {
        if (when.balanced === false) {
          report(
            'CONTRADICTORY_CONDITION',
            'warning',
            `shapeClass BAL_NO_5M 与 balanced:false 矛盾；规则保留在 IR/可执行集，但条件恒不成立`,
            location,
            rule.id,
            { shapeClass: shape, balanced: false },
          );
        } else {
          when.balanced = true;
        }
        if (when.fiveCardMajor === true) {
          report(
            'CONTRADICTORY_CONDITION',
            'warning',
            `shapeClass BAL_NO_5M 与 fiveCardMajor:true 矛盾；规则保留在 IR/可执行集，但条件恒不成立`,
            location,
            rule.id,
            { shapeClass: shape, fiveCardMajor: true },
          );
        } else {
          when.fiveCardMajor = false;
        }
      }
    }

    const specificity = rule.specificity ?? Object.keys(rule.when).length;
    const compiled: CompiledRule = {
      id: rule.id,
      description: rule.description ?? '',
      sequence: toRuntimeSequence(rule.sequence),
      when: when as ConditionSpec,
      action: toRuntimeAction(rule.action),
      priority: rule.priority,
      specificity,
      sourceIndex: index,
      sourceId: sourceRuleId(rule.id),
      ...(rule.tags !== undefined ? { tags: [...rule.tags] } : {}),
      ...(rule.source ? { source: rule.source } : {}),
    };
    rules.push(compiled);
  });

  // 同优先级、同具体度、同序列但动作冲突 → 依赖声明顺序，无法从规则本身裁决。
  const groups = new Map<string, CompiledRule[]>();
  for (const rule of rules) {
    const key = `${rule.priority}\u0000${rule.specificity}\u0000${rule.sequence}`;
    const group = groups.get(key);
    if (group) group.push(rule);
    else groups.set(key, [rule]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const actions = new Set(group.map((rule) => rule.action));
    if (actions.size < 2) continue;
    report(
      'AMBIGUOUS_RULES',
      'warning',
      `同优先级/同具体度/同序列的规则动作冲突：${group.map((rule) => rule.id).join(', ')}`,
      compiledLocation(group[0], options),
      group[0].id,
      {
        ruleIds: group.map((rule) => rule.id),
        actions: [...actions],
        priority: group[0].priority,
        specificity: group[0].specificity,
        sequence: group[0].sequence,
      },
    );
  }

  return {
    rules,
    diagnostics: sortDiagnostics(diagnostics),
    rulesetId: computeRulesetId(ir),
  };
}

/** 去掉编译器的附加字段，得到现有运行时可直接消费的 BiddingRule[]。 */
export function toBiddingRules(rules: CompiledRule[]): BiddingRule[] {
  return rules.map((rule) => ({
    id: rule.id,
    description: rule.description,
    sequence: rule.sequence,
    when: rule.when,
    action: rule.action,
    priority: rule.priority,
  }));
}
