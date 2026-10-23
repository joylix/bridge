/// <reference lib="webworker" />
/**
 * DDS 双明手求解 Web Worker。
 *
 * `bridge-dds` 是同步阻塞 API，且 WASM 初始化有一定开销，因此放在 Worker 中；
 * 主线程只通过 id 请求/响应，不阻塞牌桌交互。
 */

import { Dds, loadDds } from 'bridge-dds';
import type {
  DdsAnalyzeRequest,
  DdsAnalyzeResponse,
  DdsParResult,
  DdsPlayRequest,
  DdsPlayResponse,
  DdsPlaySampleResult,
  DdsWorkerResponse,
} from './types';
import { dealerToDds, vulnerabilityToDds } from './types';

let instancePromise: Promise<Dds> | null = null;

function getDds(): Promise<Dds> {
  if (!instancePromise) {
    instancePromise = loadDds().then((module) => new Dds(module));
  }
  return instancePromise;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function analyze(request: DdsAnalyzeRequest): Promise<DdsAnalyzeResponse> {
  const started = performance.now();
  try {
    const dds = await getDds();
    const tableResult = dds.CalcDDTablePBN({ cards: request.pbn });
    const table = tableResult.resTable.map((row) => [...row]);

    let par: DdsParResult | null = null;
    try {
      const parResult = dds.DealerPar(
        tableResult,
        dealerToDds(request.dealer),
        vulnerabilityToDds(request.vulnerability),
      );
      par = {
        score: parResult.score,
        contracts: [...parResult.contracts],
      };
    } catch {
      // Par 计算不支持的牌例不影响 DD 表展示。
      par = null;
    }

    return {
      id: request.id,
      ok: true,
      table,
      par,
      elapsedMs: Math.round(performance.now() - started),
    };
  } catch (error) {
    return { id: request.id, ok: false, error: errorMessage(error) };
  }
}

async function solvePlaySamples(request: DdsPlayRequest): Promise<DdsPlayResponse> {
  const started = performance.now();
  try {
    const dds = await getDds();
    const results: DdsPlaySampleResult[] = [];
    for (const sample of request.samples) {
      try {
        // solutions=3 在 DDS 中表示“所有合法牌”（等值牌合并）。
        const future = dds.SolveBoardPBN(
          {
            trump: sample.trump,
            first: sample.first,
            currentTrickSuit: sample.currentTrickSuit,
            currentTrickRank: sample.currentTrickRank,
            remainCards: sample.remainCards,
          },
          -1,
          3,
          0,
        );
        const cards = [];
        for (let i = 0; i < future.cards; i++) {
          cards.push({
            suit: future.suit[i],
            rank: future.rank[i],
            equals: future.equals[i],
            score: future.score[i],
          });
        }
        results.push({ cards });
      } catch {
        // 单个非法样本（极少数残局边界）跳过，不让整批求解失败。
        results.push({ cards: [] });
      }
    }
    if (results.every((r) => r.cards.length === 0)) {
      throw new Error('所有打牌样本均无法求解');
    }
    return {
      id: request.id,
      ok: true,
      samples: results,
      elapsedMs: Math.round(performance.now() - started),
    };
  } catch (error) {
    return { id: request.id, ok: false, error: errorMessage(error) };
  }
}

self.addEventListener('message', (event: MessageEvent<DdsAnalyzeRequest | DdsPlayRequest>) => {
  const request = event.data;
  if (!request) return;
  void (async () => {
    let response: DdsWorkerResponse;
    if (request.type === 'analyze') response = await analyze(request);
    else if (request.type === 'play') response = await solvePlaySamples(request);
    else return;
    self.postMessage(response);
  })();
});
