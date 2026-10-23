// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { Dds, loadDds } from 'bridge-dds';

const SAMPLE_PBN =
  'N:5.J653.Q64.KJT74 KT64.Q72.AJ5.A62 J3.AKT98.K832.Q3 AQ9872.4.T97.985';

describe('DDS WASM 求解器', () => {
  let dds: Dds;

  beforeAll(async () => {
    const module = await loadDds();
    dds = new Dds(module);
  }, 30_000);

  it('对已知牌例返回稳定的双明手结果表', () => {
    const result = dds.CalcDDTablePBN({ cards: SAMPLE_PBN });
    expect(result.resTable).toEqual([
      [4, 9, 4, 9],
      [9, 3, 9, 3],
      [8, 5, 8, 5],
      [8, 4, 8, 4],
      [4, 8, 4, 8],
    ]);
  }, 30_000);

  it('能求解带当前墩的残局并返回候选牌', () => {
    // 东家首攻 ♠4；remainCards 不包含本墩已出的牌，first=East
    const remainCards =
      'E:KT6.Q72.AJ5.A62 J3.AKT98.K832.Q3 AQ9872.4.T97.985 5.J653.Q64.KJT74';
    const result = dds.SolveBoardPBN(
      {
        trump: 4,
        first: 1,
        currentTrickSuit: [0, 0, 0],
        currentTrickRank: [4, 0, 0],
        remainCards,
      },
      -1,
      3,
      0,
    );
    expect(result.cards).toBeGreaterThan(0);
    for (let i = 0; i < result.cards; i++) {
      expect(result.suit[i]).toBeGreaterThanOrEqual(0);
      expect(result.suit[i]).toBeLessThanOrEqual(3);
      expect(result.rank[i]).toBeGreaterThanOrEqual(2);
      expect(result.rank[i]).toBeLessThanOrEqual(14);
      expect(result.score[i]).toBeGreaterThanOrEqual(0);
    }
  }, 30_000);

  it('能计算 Par 定约', () => {
    const table = dds.CalcDDTablePBN({ cards: SAMPLE_PBN });
    // N 发牌、无局：Direction.North=0, Vulnerable.None=0
    const par = dds.DealerPar(table, 0, 0);
    expect(par.score).toBe(-100);
    expect(par.contracts).toEqual(['4H*-NS-1']);
  }, 30_000);
});
