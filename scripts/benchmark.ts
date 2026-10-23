/**
 * 固定种子基准测试 CLI。
 *
 * 示例：
 *   npm run benchmark -- --deals 20 --seed 2026
 *   npm run benchmark -- --deals 100 --seed 2026 --json
 */

import { formatBenchmark, runBenchmark } from '../src/benchmark/benchmark';
import { createDdsPlayDecider } from '../src/benchmark/ddsDecider';
import { annotatePar } from '../src/benchmark/par';
import { loadBiddingRules, loadLeadRules } from '../src/engine/loader';

interface CliOptions {
  deals: number;
  seed: number;
  bidding: string;
  leads: string;
  json: boolean;
  dds: boolean;
  par: boolean;
  vsHeuristic: boolean;
  samples: number;
  objective: 'tricks' | 'contract';
  auctionConstraints: boolean;
  leadInference: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    deals: 20,
    seed: 2026,
    bidding: 'precision',
    leads: 'leads',
    json: false,
    dds: false,
    par: false,
    vsHeuristic: false,
    samples: 8,
    objective: 'contract',
    auctionConstraints: true,
    leadInference: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--dds') {
      opts.dds = true;
    } else if (arg === '--par') {
      opts.par = true;
    } else if (arg === '--vs-heuristic') {
      opts.vsHeuristic = true;
    } else if (arg === '--no-auction-constraints') {
      opts.auctionConstraints = false;
    } else if (arg === '--no-lead-inference') {
      opts.leadInference = false;
    } else if (
      arg === '--deals' ||
      arg === '--seed' ||
      arg === '--bidding' ||
      arg === '--leads' ||
      arg === '--samples' ||
      arg === '--objective'
    ) {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} 需要一个值`);
      if (arg === '--deals') opts.deals = Math.max(1, Number.parseInt(value, 10) || 1);
      else if (arg === '--seed') opts.seed = Number.parseInt(value, 10) >>> 0;
      else if (arg === '--bidding') opts.bidding = value;
      else if (arg === '--leads') opts.leads = value;
      else if (arg === '--objective') {
        if (value !== 'tricks' && value !== 'contract') {
          throw new Error('--objective 只能是 tricks 或 contract');
        }
        opts.objective = value;
      } else opts.samples = Math.max(1, Number.parseInt(value, 10) || 1);
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
      '桥牌 AI 固定种子基准测试',
      '',
      '用法: npm run benchmark -- [options]',
      '',
      '  --deals <n>      跑的副数（默认 20）',
      '  --seed <n>       基准种子（默认 2026）',
      '  --bidding <名>   叫牌规则文件（默认 precision）',
      '  --leads <名>     首攻规则文件（默认 leads）',
      '  --dds            用 DDS + 隐藏牌抽样打牌（默认启发式）',
      '  --par            用 DDS 计算 Par 并输出实际得分差',
      '  --vs-heuristic   让 DDS 一方与启发式一方对抗，输出强度差',
      '  --samples <n>    DDS 每步抽样数（默认 8，用于 --dds / --vs-heuristic）',
      '  --objective <t>  tricks=平均墩数，contract=定约优先（默认 contract）',
      '  --no-auction-constraints  关闭规则级叫牌推断（仅用于对比实验）',
      '  --no-lead-inference       关闭首攻约定推断（仅用于对比实验）',
      '  --json           输出 JSON（便于与历史基线比较）',
    ].join('\n'),
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
  const playDecider = opts.dds || opts.vsHeuristic
    ? await createDdsPlayDecider({
        samples: opts.samples,
        objective: opts.objective,
        useAuctionConstraints: opts.auctionConstraints,
        useLeadInference: opts.leadInference,
      })
    : undefined;

  if (opts.vsHeuristic) {
    if (!playDecider) throw new Error('DDS 决策器初始化失败');
    const heuristic = (context: Parameters<typeof playDecider>[0]) => context.fallback;
    const base = { deals: opts.deals, seed: opts.seed, biddingRules, leadRules };
    const ddsNS = runBenchmark({
      ...base,
      playDeciderBySide: { NS: playDecider, EW: heuristic },
    });
    const ddsEW = runBenchmark({
      ...base,
      playDeciderBySide: { NS: heuristic, EW: playDecider },
    });
    let ddsImp = 0;
    for (let i = 0; i < ddsNS.results.length; i++) {
      ddsImp += ddsNS.results[i].imp - ddsEW.results[i].imp;
    }
    const avg = ddsImp / opts.deals;
    if (opts.json) {
      console.log(JSON.stringify({ deals: opts.deals, seed: opts.seed, samples: opts.samples, ddsImp, heuristicImp: -ddsImp, avg }, null, 2));
    } else {
      console.log(
        `DDS vs 启发式：${opts.deals} 副，seed=${opts.seed}，每步 ${opts.samples} 样本 | ` +
          `DDS 侧 ${ddsImp > 0 ? '+' : ''}${ddsImp} IMP，启发式侧 ${-ddsImp > 0 ? '+' : ''}${-ddsImp} IMP | ` +
          `平均 ${avg > 0 ? '+' : ''}${avg.toFixed(2)} IMP/副`,
      );
    }
    return;
  }

  const summary = runBenchmark({
    deals: opts.deals,
    seed: opts.seed,
    biddingRules,
    leadRules,
    playDecider,
  });

  if (opts.par) await annotatePar(summary);

  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(formatBenchmark(summary));
  }
}

void main();
