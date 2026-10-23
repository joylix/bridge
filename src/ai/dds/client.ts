/**
 * DDS Web Worker 客户端。
 *
 * 单例 Worker、按请求 id 匹配响应；DDS 不可用或超时时抛出普通 Error，
 * 由 UI 回退为“分析不可用”，不影响正常记分与复盘。
 */

import type { Hand } from '../../models/hand';
import { ORDER, type GameState, type Position } from '../../models/gameState';
import { toPbnDeal } from '../../core/pbn';
import type {
  DdsAnalysis,
  DdsAnalyzeRequest,
  DdsPlayRequest,
  DdsPlaySample,
  DdsPlaySampleResult,
  DdsWorkerResponse,
} from './types';

const DEFAULT_TIMEOUT_MS = 20_000;
const PLAY_TIMEOUT_MS = 30_000;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let worker: Worker | null = null;
let sequence = 0;
const pending = new Map<number, PendingRequest>();

function rejectAll(error: Error): void {
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(error);
  }
  pending.clear();
}

function disposeWorker(): void {
  worker?.terminate();
  worker = null;
}

function ensureWorker(): Worker {
  if (typeof Worker === 'undefined') {
    throw new Error('当前环境不支持 Web Worker');
  }
  if (worker) return worker;

  const created = new Worker(new URL('./ddsWorker.ts', import.meta.url), { type: 'module' });
  created.addEventListener('message', (event: MessageEvent<DdsWorkerResponse>) => {
    const response = event.data;
    if (!response || typeof response.id !== 'number') return;
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    clearTimeout(request.timer);
    if (!response.ok) {
      request.reject(new Error(response.error || 'DDS 求解失败'));
      return;
    }
    if ('samples' in response) {
      request.resolve(response.samples);
    } else {
      request.resolve({
        table: response.table,
        par: response.par,
        elapsedMs: response.elapsedMs,
      } satisfies DdsAnalysis);
    }
  });
  created.addEventListener('error', (event) => {
    const message = event.message ? `DDS Worker 异常：${event.message}` : 'DDS Worker 异常';
    disposeWorker();
    rejectAll(new Error(message));
  });
  worker = created;
  return created;
}

/** 当前环境是否具备运行 DDS Worker 的条件（SSR/测试环境会返回 false）。 */
export function isDdsAvailable(): boolean {
  return typeof Worker !== 'undefined';
}

export interface DdsAnalyzeInput {
  hands: Record<Position, Hand>;
  dealer: Position;
  vulnerability: GameState['vulnerability'];
  timeoutMs?: number;
}

/**
 * 请求完整 52 张牌的双明手分析。
 * 牌数不完整时直接拒绝，避免把错误局面交给 DDS。
 */
export function analyzeDeal(input: DdsAnalyzeInput): Promise<DdsAnalysis> {
  const total = ORDER.reduce((sum, seat) => sum + (input.hands[seat]?.length ?? 0), 0);
  if (total !== 52) {
    return Promise.reject(new Error(`双明手分析需要完整的 52 张牌，当前为 ${total} 张`));
  }

  let pbn: string;
  try {
    pbn = toPbnDeal(input.hands);
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }

  let target: Worker;
  try {
    target = ensureWorker();
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }

  const id = ++sequence;
  return new Promise<DdsAnalysis>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('双明手分析超时'));
    }, input.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    pending.set(id, {
      resolve: (value) => resolve(value as DdsAnalysis),
      reject,
      timer,
    });
    const request: DdsAnalyzeRequest = {
      id,
      type: 'analyze',
      pbn,
      dealer: input.dealer,
      vulnerability: input.vulnerability,
    };
    target.postMessage(request);
  });
}

/**
 * 批量求解打牌残局。每个样本是一副合法的剩余牌分布；返回每样本的最优/候选牌。
 * 由调用方负责隐藏牌抽样，本函数不接触完整牌局。
 */
export function solvePlaySamples(
  samples: DdsPlaySample[],
  timeoutMs = PLAY_TIMEOUT_MS,
): Promise<DdsPlaySampleResult[]> {
  if (samples.length === 0) return Promise.resolve([]);

  let target: Worker;
  try {
    target = ensureWorker();
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }

  const id = ++sequence;
  return new Promise<DdsPlaySampleResult[]>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('DDS 打牌求解超时'));
    }, timeoutMs);

    pending.set(id, {
      resolve: (value) => resolve(value as DdsPlaySampleResult[]),
      reject,
      timer,
    });
    const request: DdsPlayRequest = { id, type: 'play', samples };
    target.postMessage(request);
  });
}

/** 主动释放 Worker（测试或页面销毁时使用）。 */
export function disposeDdsWorker(): void {
  rejectAll(new Error('DDS Worker 已关闭'));
  disposeWorker();
}
