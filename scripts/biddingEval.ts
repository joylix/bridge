/**
 * 固定种子“纯叫牌”评估。
 *
 * 与 `benchmark.ts --par` 不同，这里用 DDS 双明手结果替代实际打牌：
 * 对 AI 叫到的定约查 DD 表得到必然墩数，再计分并与 Par 比较。这样
 * 打牌失误不会污染叫牌指标，适合评估规则改动是“漏局/超叫/定约错位”。
 *
 * 用法：
 *   npx vite-node scripts/biddingEval.ts --deals 100 --seed 2026 --limit 20
 */

import { Dds, loadDds } from 'bridge-dds';
import { runBenchmark, type BenchmarkDealResult } from '../src/benchmark/benchmark';
import { loadBiddingRules, loadLeadRules } from '../src/engine/loader';
import { toPbnDeal } from '../src/core/pbn';
import { computeScore } from '../src/core/scoring';
import { impsFromScoreDiff } from '../src/core/imps';
import { hcp } from '../src/core/evaluate';
import { getSide, type Contract, type Position } from '../src/models/gameState';
import {
  DD_SEATS,
  DD_STRAINS,
  dealerToDds,
  vulnerabilityToDds,
  type DdsParResult,
} from '../src/ai/dds/types';

interface CliOptions {
  deals: number;
  seed: number;
  bidding: string;
  leads: string;
  limit: number;
  json: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    deals: 100,
    seed: 2026,
    bidding: 'precision',
    leads: 'leads',
    limit: 20,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--deals' || arg === '--seed' || arg === '--limit' || arg === '--bidding' || arg === '--leads') {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} 需要一个值`);
      if (arg === '--deals') opts.deals = Math.max(1, Number.parseInt(value, 10) || 1);
      else if (arg === '--seed') opts.seed = Number.parseInt(value, 10) >>> 0;
      else if (arg === '--limit') opts.limit = Math.max(0, Number.parseInt(value, 10) || 0);
      else if (arg === '--bidding') opts.bidding = value;
      else opts.leads = value;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }
  return opts;
}

function printHelp(): void {
  console.log(
    [
      '纯叫牌 DDS/Par 评估',
      '',
      '用法: npx vite-node scripts/biddingEval.ts [options]',
      '',
      '  --deals <n>     副数（默认 100）',
      '  --seed <n>      固定种子（默认 2026）',
      '  --bidding <名>  叫牌规则（默认 precision）',
      '  --leads <名>    首攻规则（默认 leads，仅用于跑完整牌局）',
      '  --limit <n>     输出最差 n 副（默认 20，0=不输出明细）',
      '  --json          输出 JSON',
    ].join('\n'),
  );
}

function contractLabel(contract: Contract): string {
  const dbl = contract.doubled ? 'X' : contract.redoubled ? 'XX' : '';
  return `${contract.declarer} ${contract.level}${contract.suit}${dbl}`;
}

function isGame(contract: Contract): boolean {
  return contract.level >= 4 || (contract.level === 3 && contract.suit === 'NT');
}

function isSlam(contract: Contract): boolean {
  return contract.level >= 6;
}

function declaringHcp(result: BenchmarkDealResult, contract: Contract): number {
  const side = getSide(contract.declarer);
  const partner: Position =
    side === 'NS'
      ? contract.declarer === 'N'
        ? 'S'
        : 'N'
      : contract.declarer === 'E'
        ? 'W'
        : 'E';
  return hcp(result.hands[contract.declarer]) + hcp(result.hands[partner]);
}

function auctionText(result: BenchmarkDealResult): string {
  return result.biddingHistory
    .map((record) => {
      const call = record.call;
      return `${record.position}:${call.type === 'bid' ? `${call.level}${call.suit}` : call.type}`;
    })
    .join(' ');
}

interface EvaluatedDeal {
  index: number;
  seed: number;
  dealer: Position;
  vulnerability: string;
  contract: string | null;
  auction: string;
  hcp: number;
  ddTricks: number | null;
  parScore: number;
  parContracts: string[];
  ddDiff: number;
  ddImp: number;
  down: number;
  game: boolean;
  slam: boolean;
  parGame: boolean;
  parSlam: boolean;
  missedGame: boolean;
  missedSlam: boolean;
  overbid: boolean;
}

function evaluateDeal(
  dds: Dds,
  result: BenchmarkDealResult,
): EvaluatedDeal | null {
  if (!result.contract) return null;
  const pbn = toPbnDeal(result.hands, result.dealer);
  const tableResult = dds.CalcDDTablePBN({ cards: pbn });
  const table = tableResult.resTable;
  const par: DdsParResult = dds.DealerPar(
    tableResult,
    dealerToDds(result.dealer),
    vulnerabilityToDds(result.vulnerability),
  );

  const contract = result.contract;
  const row = DD_STRAINS.indexOf(contract.suit);
  const col = DD_SEATS.indexOf(contract.declarer);
  const ddTricks = table[row]?.[col] ?? 0;
  const ddScore = computeScore(contract, ddTricks, result.vulnerability);
  const ddNet = ddScore.NS - ddScore.EW;
  const ddDiff = ddNet - par.score;
  const ddImp = impsFromScoreDiff(ddDiff);
  const parAbs = Math.abs(par.score);
  // 用 350 区分“成局/更大罚分”与普通部分定约；Par 为 300 时通常是
  // 对手牺牲或加倍罚分，不强行归入“漏局”。
  const parGame = parAbs >= 350;
  const parSlam = parAbs >= 950;
  const game = isGame(contract);
  const slam = isSlam(contract);
  const down = Math.max(0, contract.level + 6 - ddTricks);

  return {
    index: result.index,
    seed: result.seed,
    dealer: result.dealer,
    vulnerability: result.vulnerability,
    contract: contractLabel(contract),
    auction: auctionText(result),
    hcp: declaringHcp(result, contract),
    ddTricks,
    parScore: par.score,
    parContracts: [...par.contracts],
    ddDiff,
    ddImp,
    down,
    game,
    slam,
    parGame,
    parSlam,
    missedGame: !game && parGame,
    missedSlam: !slam && parSlam,
    // 超叫：叫到成局/满贯但 DD 宕，且 Par 并不是成局/满贯。
    overbid: (game || slam) && down > 0 && !parGame && !parSlam,
  };
}

function formatDeal(e: EvaluatedDeal): string {
  const par = e.parContracts.length > 0 ? e.parContracts.join(',') : String(e.parScore);
  const tags = [
    e.missedGame ? '漏局' : '',
    e.missedSlam ? '漏贯' : '',
    e.overbid ? '超叫' : '',
    e.down > 0 ? `宕${e.down}` : '',
  ].filter(Boolean);
  return (
    `#${String(e.index).padStart(3, '0')} seed=${e.seed} ${e.dealer}/${e.vulnerability} ` +
    `${(e.contract ?? 'Pass').padEnd(9)} DD=${e.ddTricks} par=${par} ` +
    `diff=${e.ddDiff > 0 ? '+' : ''}${e.ddDiff} imp=${e.ddImp > 0 ? '+' : ''}${e.ddImp} ` +
    `hcp=${e.hcp}${tags.length ? ` [${tags.join('/')}]` : ''}`
  );
}

async function main(): Promise<void> {
  let opts: CliOptions;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printHelp();
    process.exitCode = 1;
    return;
  }

  const biddingRules = loadBiddingRules(opts.bidding);
  const leadRules = loadLeadRules(opts.leads);
  const summary = runBenchmark({
    deals: opts.deals,
    seed: opts.seed,
    biddingRules,
    leadRules,
  });

  const module = await loadDds();
  const dds = new Dds(module);
  const evaluated: EvaluatedDeal[] = [];
  let reportedError = false;
  for (const result of summary.results) {
    try {
      const deal = evaluateDeal(dds, result);
      if (deal) evaluated.push(deal);
    } catch (error) {
      if (!reportedError) {
        reportedError = true;
        console.error('biddingEval skipped deal:', error);
      }
    }
  }

  const totalImp = evaluated.reduce((sum, deal) => sum + deal.ddImp, 0);
  const totalAbsImp = evaluated.reduce((sum, deal) => sum + Math.abs(deal.ddImp), 0);
  const avgImp = evaluated.length > 0 ? totalImp / evaluated.length : 0;
  const avgAbsImp = evaluated.length > 0 ? totalAbsImp / evaluated.length : 0;
  const missedGames = evaluated.filter((deal) => deal.missedGame);
  const missedSlams = evaluated.filter((deal) => deal.missedSlam);
  const overbids = evaluated.filter((deal) => deal.overbid);
  const passOuts = opts.deals - evaluated.length;
  const worst = [...evaluated].sort((a, b) => a.ddImp - b.ddImp).slice(0, opts.limit);

  const payload = {
    deals: opts.deals,
    seed: opts.seed,
    evaluated: evaluated.length,
    passOuts,
    totalImp,
    avgImp,
    totalAbsImp,
    avgAbsImp,
    missedGames: missedGames.length,
    missedSlams: missedSlams.length,
    overbids: overbids.length,
    worst,
  };

  if (opts.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(
    `纯叫牌 DDS/Par：${opts.deals} 副，seed=${opts.seed}，有效 ${evaluated.length} 副 | ` +
      `平均 ${avgImp > 0 ? '+' : ''}${avgImp.toFixed(2)} IMP/副（NS 视角） | ` +
      `绝对偏差 ${avgAbsImp.toFixed(2)} IMP/副 | ` +
      `漏局 ${missedGames.length}，漏贯 ${missedSlams.length}，超叫 ${overbids.length}，流局 ${passOuts}`,
  );
  if (opts.limit > 0) {
    console.log('--- 最差明细 ---');
    for (const deal of worst) console.log(formatDeal(deal));
  }
}

void main();
