import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../brules/sha256';
import {
  WBF_2017,
  WBF_2017_VERSION,
  WBF_LAWS_VERSION,
  impFromDiff,
  signedImpFromDiff,
  teamImpFromRaw,
  validateImpTable,
} from './impTable';

function bandsHash(): string {
  return `sha256:${sha256Hex(JSON.stringify(WBF_2017.bands))}`;
}

describe('WBF 2017 IMP 表', () => {
  it('随包表的版本、档位结构与哈希自洽', () => {
    expect(WBF_2017.version).toBe(WBF_2017_VERSION);
    expect(WBF_2017.rulesVersion).toBe(WBF_LAWS_VERSION);
    expect(validateImpTable()).toEqual([]);
    expect(bandsHash()).toBe(WBF_2017.bandsSha256);
    expect(WBF_2017.bands).toHaveLength(25);
    expect(WBF_2017.maxImp).toBe(24);
  });

  it('覆盖 0–24 的全部 IMP 档位', () => {
    expect(new Set(WBF_2017.bands.map((band) => band.imp)).size).toBe(25);
  });

  it('边界 0/±10/±20/±40/±80/±120/±200/±500/±1000/±2000（附录 C-4）', () => {
    const cases: Array<[number, number]> = [
      [0, 0],
      [10, 0],
      [20, 1],
      [40, 1],
      [80, 2],
      [120, 3],
      [200, 5],
      [500, 11],
      [1000, 14],
      [2000, 19],
    ];
    for (const [diff, expected] of cases) {
      expect(impFromDiff(diff)).toBe(expected);
      expect(impFromDiff(-diff)).toBe(expected);
      expect(signedImpFromDiff(diff)).toBe(expected);
      expect(signedImpFromDiff(-diff)).toBe(diff === 0 ? 0 : -expected);
    }
  });

  it('超上限按表上限档（附录 C-11）', () => {
    expect(impFromDiff(5000)).toBe(24);
    expect(impFromDiff(Number.POSITIVE_INFINITY)).toBe(24);
    expect(signedImpFromDiff(-5000)).toBe(-24);
  });

  it('带符号换算：平分为 0，正为 NS，负为 EW', () => {
    expect(signedImpFromDiff(0)).toBe(0);
    expect(signedImpFromDiff(30)).toBe(1);
    expect(signedImpFromDiff(-30)).toBe(-1);
    expect(teamImpFromRaw(680)).toBe(12);
    expect(teamImpFromRaw(-680)).toBe(-12);
  });

  it('拒绝被篡改的档位', () => {
    const broken = {
      ...WBF_2017,
      bands: WBF_2017.bands.map((band, index) =>
        index === 3 ? { ...band, imp: 99 } : band,
      ),
    };
    expect(validateImpTable(broken).length).toBeGreaterThan(0);
  });
});
