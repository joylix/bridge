import { describe, expect, it } from 'vitest';
import { canAdjustBoard, settleTeamBoards, type TeamBoardInput } from './team';

/**
 * SRS V0.7 附录 C：队式赛结算表驱动测试。
 * 期望 IMP 一律由 WBF 2017 表计算，不在测试里硬编码另一套换算。
 */
function board(
  tableBoardId: string,
  status: TeamBoardInput['status'],
  redTeamRaw: number | null,
): TeamBoardInput {
  return { tableBoardId, status, redTeamRaw };
}

describe('附录 C 队式赛结算', () => {
  it('C-1 正负分：+650、−620 → +30 → 1 IMP', () => {
    const result = settleTeamBoards([board('t1', 'PLAYED', 650), board('t2', 'PLAYED', -620)]);
    expect(result.redTeamRaw).toBe(30);
    expect(result.blueTeamRaw).toBe(-30);
    expect(result.teamImp).toBe(1);
    expect(result.status).toBe('COMPLETE');
    expect(result.impTableVersion).toBe('wbf-2017');
  });

  it('C-2 零分：+420、−420 → 0 IMP', () => {
    const result = settleTeamBoards([board('t1', 'PLAYED', 420), board('t2', 'PLAYED', -420)]);
    expect(result.redTeamRaw).toBe(0);
    expect(result.teamImp).toBe(0);
  });

  it('C-3 大分差：+1430、−750 → +680 → 12 IMP（不是 1360 的 23）', () => {
    const result = settleTeamBoards([board('t1', 'PLAYED', 1430), board('t2', 'PLAYED', -750)]);
    expect(result.redTeamRaw).toBe(680);
    expect(result.teamImp).toBe(12);
  });

  it('C-5 多桌（4 桌）：+650、−620、+100、−100 → +30 → 1 IMP', () => {
    const result = settleTeamBoards([
      board('t1', 'PLAYED', 650),
      board('t2', 'PLAYED', -620),
      board('t3', 'PLAYED', 100),
      board('t4', 'PLAYED', -100),
    ]);
    expect(result.redTeamRaw).toBe(30);
    expect(result.teamImp).toBe(1);
    expect(result.inputs).toEqual(['t1', 't2', 't3', 't4']);
  });

  it('C-6 多副累计：逐副换算后相加，不是累计差一次换算', () => {
    const boards: Array<[number, number]> = [
      [30, 1],
      [-20, -1],
      [50, 2],
    ];
    let accumulated = 0;
    for (const [raw, expected] of boards) {
      const result = settleTeamBoards([board('t1', 'PLAYED', raw)]);
      expect(result.teamImp).toBe(expected);
      accumulated += result.teamImp ?? 0;
    }
    expect(accumulated).toBe(2);
  });

  it('C-7 取消副：任一桌 CANCELLED → 不计算，artificialAverage 单独保存', () => {
    const result = settleTeamBoards([board('t1', 'CANCELLED', null), board('t2', 'PLAYED', 620)]);
    expect(result.status).toBe('CANCELLED');
    expect(result.redTeamRaw).toBeNull();
    expect(result.teamImp).toBeNull();
    expect(result.reason).toBe('BOARD_CANCELLED');
  });

  it('C-8 缺桌：一桌 INCOMPLETE → SessionBoard INCOMPLETE，不计算', () => {
    const result = settleTeamBoards([board('t1', 'PLAYED', 650), board('t2', 'INCOMPLETE', null)]);
    expect(result.status).toBe('INCOMPLETE');
    expect(result.teamImp).toBeNull();
    expect(result.reason).toBe('BOARD_INCOMPLETE');
  });

  it('C-9 取消+调整并存：CANCELLED→ADJUSTED(+300) 与 +620 → +920 → 14 IMP', () => {
    const result = settleTeamBoards([board('t1', 'ADJUSTED', 300), board('t2', 'PLAYED', 620)]);
    expect(result.status).toBe('ADJUSTED');
    expect(result.redTeamRaw).toBe(920);
    expect(result.teamImp).toBe(14);
  });

  it('C-10 已取消未 REOPEN 再调整 → BOARD_CANCELLED_ADJUST_FORBIDDEN', () => {
    expect(canAdjustBoard({ status: 'CANCELLED' })).toEqual({
      allowed: false,
      code: 'BOARD_CANCELLED_ADJUST_FORBIDDEN',
    });
    expect(canAdjustBoard({ status: 'CANCELLED', hasReopenAudit: true })).toEqual({
      allowed: true,
    });
    expect(canAdjustBoard({ status: 'PLAYED' })).toEqual({ allowed: true });
    expect(canAdjustBoard({ status: 'ADJUSTED' })).toEqual({ allowed: true });
    expect(canAdjustBoard({ status: 'IN_PROGRESS' })).toEqual({
      allowed: false,
      code: 'BOARD_STATUS_ADJUST_FORBIDDEN',
    });
  });

  it('REOPENED / 空集合不计算', () => {
    expect(settleTeamBoards([board('t1', 'REOPENED', null)]).status).toBe('REOPENED');
    expect(settleTeamBoards([]).status).toBe('PENDING');
  });
});
