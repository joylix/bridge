// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { deriveSeed, formatBenchmark, runBenchmark, simulateDeal } from './benchmark';
import { loadBiddingRules, loadLeadRules } from '../engine/loader';

const biddingRules = loadBiddingRules('precision');
const leadRules = loadLeadRules('leads');

describe('固定种子基准测试', () => {
  it('同一 seed 派生出的副种子稳定且不同', () => {
    expect(deriveSeed(2026, 0)).toBe(deriveSeed(2026, 0));
    expect(deriveSeed(2026, 0)).not.toBe(deriveSeed(2026, 1));
  });

  it('单副模拟可完整打完并计分', () => {
    const result = simulateDeal({
      seed: 12345,
      dealer: 'N',
      biddingRules,
      leadRules,
    });
    expect(result.hands).toBeDefined();
    expect(result.biddingHistory.length).toBeGreaterThan(0);
    if (result.contract) {
      expect(result.tricks).toHaveLength(13);
      expect(result.tricks.every((t) => t.plays.length === 4)).toBe(true);
      expect(result.declarerTricks).toBeGreaterThanOrEqual(0);
      expect(result.declarerTricks).toBeLessThanOrEqual(13);
    } else {
      expect(result.score).toEqual({ NS: 0, EW: 0 });
    }
  });

  it('同一批 seed 的结果完全可复现', () => {
    const options = { deals: 3, seed: 77, biddingRules, leadRules };
    const first = runBenchmark(options);
    const second = runBenchmark(options);
    expect(second.results.map((r) => r.score)).toEqual(first.results.map((r) => r.score));
    expect(second.results.map((r) => r.biddingHistory)).toEqual(first.results.map((r) => r.biddingHistory));
    expect(second.impNS).toBe(first.impNS);
  });

  it('按阵营注入出牌决策器时保持默认流程', () => {
    const options = { seed: 2468, dealer: 'N' as const, biddingRules, leadRules };
    const normal = simulateDeal(options);
    const split = simulateDeal({
      ...options,
      playDeciderBySide: { NS: (context) => context.fallback, EW: (context) => context.fallback },
    });
    expect(split.score).toEqual(normal.score);
    expect(split.biddingHistory).toEqual(normal.biddingHistory);
    expect(split.tricks).toEqual(normal.tricks);
  });

  it('汇总输出包含每副与总计', () => {
    const summary = runBenchmark({ deals: 2, seed: 1, biddingRules, leadRules });
    const text = formatBenchmark(summary);
    expect(text).toContain('#01');
    expect(text).toContain('2 deals');
    expect(summary.deals).toBe(2);
    expect(summary.nsWins + summary.ewWins + summary.pushes).toBe(2);
  });
});
