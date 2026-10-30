/**
 * 可复现随机流（BRULES v0.5 reproducibility.md §3）。
 *
 * streamSeed(baseSeed, index, stream) =
 *   uint32be(SHA-256(ASCII("BRIDGE-RNG/1|" + baseSeed + "|" + index + "|" + stream))[0..4])
 *
 * PRNG 沿用 engine/arbiter.ts 的 mulberry32 变体，不在 v0.5 中更换。
 */

import { makeRng } from '../engine/arbiter';
import { sha256Hex } from '../brules/sha256';
import type { EngineStreamSeeds } from './types';

export const RNG_STREAMS = ['deal', 'bidding', 'play', 'dds'] as const;
export type RngStream = (typeof RNG_STREAMS)[number];

export function uint32(value: number): number {
  return value >>> 0;
}

/** 由 baseSeed、副序号与流名派生 32 位无符号种子。 */
export function streamSeed(baseSeed: number, index: number, stream: RngStream): number {
  const digest = sha256Hex(`BRIDGE-RNG/1|${uint32(baseSeed)}|${index >>> 0}|${stream}`);
  return Number.parseInt(digest.slice(0, 8), 16) >>> 0;
}

/** 一次性派生四条流（seeded 发牌使用）。 */
export function deriveStreamSeeds(baseSeed: number, index = 0): Required<EngineStreamSeeds> {
  return {
    deal: streamSeed(baseSeed, index, 'deal'),
    bidding: streamSeed(baseSeed, index, 'bidding'),
    play: streamSeed(baseSeed, index, 'play'),
    dds: streamSeed(baseSeed, index, 'dds'),
  };
}

/** 为 imported-pbn 记录派生 bidding/play/dds（发牌不消耗随机流）。 */
export function deriveImportedSeeds(
  baseSeed: number,
  index = 0,
): Pick<Required<EngineStreamSeeds>, 'bidding' | 'play' | 'dds'> {
  return {
    bidding: streamSeed(baseSeed, index, 'bidding'),
    play: streamSeed(baseSeed, index, 'play'),
    dds: streamSeed(baseSeed, index, 'dds'),
  };
}

export interface StreamRngs {
  bidding: () => number;
  play: () => number;
  dds: () => number;
  deal?: () => number;
}

/** 从记录中的实际种子恢复随机源；缺失的流回退到 bidding。 */
export function createStreamRngs(seeds: EngineStreamSeeds, fallbackSeed: number): StreamRngs {
  const base = uint32(seeds.bidding ?? fallbackSeed);
  return {
    deal: seeds.deal === undefined ? undefined : makeRng(uint32(seeds.deal)),
    bidding: makeRng(base),
    play: makeRng(uint32(seeds.play ?? base)),
    dds: makeRng(uint32(seeds.dds ?? base)),
  };
}

/** 兼容旧记录：四条流全部由 rngSeed 初始化（legacy-shared）。 */
export function createLegacySharedRngs(seed: number): Required<StreamRngs> {
  const base = uint32(seed);
  return {
    deal: makeRng(base),
    bidding: makeRng(base),
    play: makeRng(base),
    dds: makeRng(base),
  };
}

/** 生成一个 32 位随机种子（浏览器与 Node 均可用）。 */
export function randomSeed(): number {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.getRandomValues) {
    const buf = new Uint32Array(1);
    cryptoObj.getRandomValues(buf);
    return buf[0] >>> 0;
  }
  return ((Date.now() >>> 0) ^ (Math.floor(Math.random() * 0xffffffff) >>> 0)) >>> 0;
}
