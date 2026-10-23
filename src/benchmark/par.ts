/**
 * 基准测试的可选 Par 对照。
 *
 * 用 DDS 计算每副牌的双明手 Par 分数，再与 AI 实际得分比较。由于 Par 是
 * 双方最优叫牌/打牌的结果，这个差值比“同一 AI 左右互搏的 NS-EW 差”更能
 * 反映真实强度；例如漏局、超叫、打牌失误都会体现为负 IMP。
 */

import { Dds, loadDds } from 'bridge-dds';
import { toPbnDeal } from '../core/pbn';
import { impsFromScoreDiff } from '../core/imps';
import { dealerToDds, vulnerabilityToDds } from '../ai/dds/types';
import type { BenchmarkSummary } from './benchmark';

export async function annotatePar(summary: BenchmarkSummary): Promise<void> {
  const module = await loadDds();
  const dds = new Dds(module);
  let parImp = 0;
  let count = 0;

  for (const result of summary.results) {
    try {
      const pbn = toPbnDeal(result.hands, result.dealer);
      const table = dds.CalcDDTablePBN({ cards: pbn });
      const par = dds.DealerPar(
        table,
        dealerToDds(result.dealer),
        vulnerabilityToDds(result.vulnerability),
      );
      result.parScore = par.score;
      result.parContracts = [...par.contracts];
      // 实际得分是 {NS, EW} 两个非负数，先转成 NS 净分再与 Par 比较。
      result.parDiff = result.score.NS - result.score.EW - par.score;
      parImp += impsFromScoreDiff(result.parDiff);
      count += 1;
    } catch {
      // 个别牌例 Par 不可用时跳过，不影响其余结果。
    }
  }

  if (count > 0) {
    summary.parDeals = count;
    summary.parImpNS = parImp;
    summary.avgParImp = parImp / count;
  }
}
