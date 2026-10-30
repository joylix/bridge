import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findBidCandidates } from '../engine/matcher';
import { parseHand } from '../testing/testUtils';
import { compileDsl, compileRules, parseDsl, parseIrJson, toBiddingRules } from './index';
import { computeRulesetId, semanticProjection } from './ruleset';

const EXPECTED_ID = 'sha256:39e571721cec89a8d3c8c1e7d469953f369961d5aaf4ed6c557a0e76aa8b7cd7';

function example(name: string): string {
  return readFileSync(resolve(process.cwd(), 'docs/brules-v0.5/examples', name), 'utf8');
}

describe('minimal 示例端到端', () => {
  it('DSL 与 IR JSON 产出相同的语义投影和 rulesetId', () => {
    const dslResult = parseDsl(example('minimal.brules'), { file: 'minimal.brules' });
    const jsonResult = parseIrJson(example('minimal.rules.json'), { file: 'minimal.rules.json' });
    expect(dslResult.diagnostics).toEqual([]);
    expect(jsonResult.diagnostics).toEqual([]);
    expect(dslResult.ir).not.toBeNull();
    expect(jsonResult.ir).not.toBeNull();
    expect(semanticProjection(dslResult.ir!)).toEqual(semanticProjection(jsonResult.ir!));
    expect(computeRulesetId(dslResult.ir!)).toBe(EXPECTED_ID);
    expect(computeRulesetId(jsonResult.ir!)).toBe(EXPECTED_ID);
  });

  it('编译得到两条规则并按声明顺序排列', () => {
    const parsed = parseDsl(example('minimal.brules'), { file: 'minimal.brules' });
    const compiled = compileRules(parsed.ir!);
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.rulesetId).toBe(EXPECTED_ID);
    expect(compiled.rules.map((rule) => rule.id)).toEqual(['open_1nt', 'open_1c']);
    expect(compiled.rules[0].when).toEqual({
      hcp: '${open1ntMin}-${open1ntMax}',
      balanced: true,
      fiveCardMajor: false,
    });
    expect(compiled.rules[1].when).toEqual({ hcp: '16+', balanced: true });
    expect(compiled.rules.map((rule) => rule.specificity)).toEqual([2, 2]);
  });

  it('compileDsl 便捷管道与分步结果一致', () => {
    const pipeline = compileDsl(example('minimal.brules'), { file: 'minimal.brules' });
    expect(pipeline.diagnostics).toEqual([]);
    expect(pipeline.rulesetId).toBe(EXPECTED_ID);
    expect(pipeline.rules.map((rule) => rule.id)).toEqual(['open_1nt', 'open_1c']);
  });

  it('编译结果可被现有 matcher 消费', () => {
    const pipeline = compileDsl(example('minimal.brules'));
    const rules = toBiddingRules(pipeline.rules);
    const hand = parseHand('SAKQ2 HJ93 DAK43 C87');
    const candidates = findBidCandidates(hand, [], 'S', null, 1, rules);
    expect(candidates.map((candidate) => candidate.rule.id)).toEqual(['open_1nt', 'open_1c']);
    expect(candidates[0].rule.action).toBe('1NT');
  });

  it('DSL 错误时管道不产出规则与 rulesetId', () => {
    const pipeline = compileDsl('VERSION: BRULES/0.5\nFORMAT: bridge-rules\nKIND: bidding\nSYSTEM: test\n');
    expect(pipeline.ir).toBeNull();
    expect(pipeline.rules).toEqual([]);
    expect(pipeline.rulesetId).toBeNull();
    expect(pipeline.diagnostics.map((item) => item.code)).toContain('INVALID_RULESET');
  });
});
