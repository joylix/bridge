/**
 * WBF 2017 IMP 换算表（随包数据 + 纯函数）。
 *
 * 规范来源：`wbf-2017.json`，版本字符串固定为 `wbf-2017`。
 * 本模块不依赖 store / UI，可供单机、服务端与测试共用。
 */

import tableData from './wbf-2017.json';

export const WBF_2017_VERSION = 'wbf-2017' as const;
export const WBF_LAWS_VERSION = 'wbf-laws-2017' as const;

export interface ImpBand {
  /** 该档分差绝对值上界（含）；`null` 表示无限。 */
  maxDifference: number | null;
  imp: number;
}

export interface ImpTable {
  version: string;
  rulesVersion: string;
  title: string;
  source: string;
  note: string;
  maxImp: number;
  bandsSha256: string;
  bands: readonly ImpBand[];
}

export const WBF_2017: ImpTable = tableData as ImpTable;

/**
 * 分数差 → 无符号 IMP。
 *
 * 传入值取绝对值；按 `bands` 顺序找到第一个 `maxDifference >= abs` 的档。
 * 超过最高有限档时返回 `maxImp`（表尾 `maxDifference: null`）。
 */
export function impFromDiff(diff: number, table: ImpTable = WBF_2017): number {
  const abs = Math.abs(diff);
  for (const band of table.bands) {
    if (band.maxDifference === null || abs <= band.maxDifference) return band.imp;
  }
  return table.maxImp;
}

/** 分数差（NS − EW）→ 带符号 IMP：正数表示 NS 赢。 */
export function signedImpFromDiff(diff: number, table: ImpTable = WBF_2017): number {
  if (diff === 0) return 0;
  const imp = impFromDiff(diff, table);
  return diff > 0 ? imp : -imp;
}

/** 队式赛：红队视角原始分代数和 → 队式 IMP。 */
export function teamImpFromRaw(redTeamRaw: number, table: ImpTable = WBF_2017): number {
  return signedImpFromDiff(redTeamRaw, table);
}

/** 校验表档位单调、IMP 连续且与版本声明的上限一致。 */
export function validateImpTable(table: ImpTable = WBF_2017): string[] {
  const problems: string[] = [];
  if (table.version !== WBF_2017_VERSION) problems.push(`version 必须是 ${WBF_2017_VERSION}`);
  if (table.rulesVersion !== WBF_LAWS_VERSION) problems.push(`rulesVersion 必须是 ${WBF_LAWS_VERSION}`);
  if (table.bands.length === 0) problems.push('bands 不能为空');
  let previous = -1;
  let expectedImp = 0;
  for (const [index, band] of table.bands.entries()) {
    if (band.imp !== expectedImp) {
      problems.push(`bands[${index}].imp 应为 ${expectedImp}，实际 ${band.imp}`);
    }
    expectedImp += 1;
    if (band.maxDifference !== null) {
      if (!Number.isInteger(band.maxDifference) || band.maxDifference <= previous) {
        problems.push(`bands[${index}].maxDifference 必须严格递增`);
      }
      previous = band.maxDifference;
    } else if (index !== table.bands.length - 1) {
      problems.push(`只有最后一档可以使用 maxDifference=null`);
    }
  }
  if (table.bands[table.bands.length - 1]?.maxDifference !== null) {
    problems.push('最后一档必须覆盖无限分差（maxDifference=null）');
  }
  if (table.maxImp !== table.bands[table.bands.length - 1]?.imp) {
    problems.push('maxImp 必须等于最后一档的 imp');
  }
  return problems;
}
