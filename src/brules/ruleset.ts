/**
 * 规则集语义身份。
 *
 * rulesetId = "sha256:" + SHA-256(JCS(semanticProjection(IR)))
 * 语义投影口径见 docs/brules-v0.5/reproducibility.md §4。
 */

import { jcs } from './jcs';
import { sha256Hex } from './sha256';
import type { RulesIR } from './types';

export type SemanticProjection = Record<string, unknown>;

export function semanticProjection(ir: RulesIR): SemanticProjection {
  const projection: SemanticProjection = {
    format: ir.format,
    formatVersion: ir.formatVersion,
    kind: ir.kind,
    system: ir.system,
  };
  if (ir.systemVersion !== undefined) projection.systemVersion = ir.systemVersion;
  if (ir.defaults !== undefined) projection.defaults = { ...ir.defaults };
  if (ir.styleParams !== undefined) projection.styleParams = [...ir.styleParams];
  projection.rules = ir.rules.map((rule) => ({
    id: rule.id,
    sequence: rule.sequence,
    when: { ...rule.when },
    action: rule.action,
    priority: rule.priority,
    tags: rule.tags ?? [],
    enabled: rule.enabled ?? true,
  }));
  return projection;
}

export function computeRulesetId(ir: RulesIR): string {
  return `sha256:${sha256Hex(jcs(semanticProjection(ir)))}`;
}
