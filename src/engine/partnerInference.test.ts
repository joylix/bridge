import { describe, expect, it } from 'vitest';
import { inferPartnerHcpMin } from './partnerInference';
import { history } from '../testing/testUtils';

describe('同伴点力下限推断', () => {
  it('精确 1C 开叫为 16+，1C-1NT-2H 为 16+，2S 为 19+，3NT 为 16-18 封局', () => {
    expect(inferPartnerHcpMin(history(['S', '1C']), 'S')).toBe(16);
    expect(
      inferPartnerHcpMin(
        history(['S', '1C'], ['W', 'Pass'], ['N', '1NT'], ['E', 'Pass'], ['S', '2H']),
        'S',
      ),
    ).toBe(16);
    expect(
      inferPartnerHcpMin(
        history(['S', '1C'], ['W', 'Pass'], ['N', '1NT'], ['E', 'Pass'], ['S', '2S']),
        'S',
      ),
    ).toBe(19);
    expect(
      inferPartnerHcpMin(
        history(['S', '1C'], ['W', 'Pass'], ['N', '1NT'], ['E', 'Pass'], ['S', '3NT']),
        'S',
      ),
    ).toBe(16);
  });

  it('常见开叫的下限', () => {
    expect(inferPartnerHcpMin(history(['S', '1NT']), 'S')).toBe(13);
    expect(inferPartnerHcpMin(history(['S', '1H']), 'S')).toBe(11);
    expect(inferPartnerHcpMin(history(['S', '2NT']), 'S')).toBe(20);
    expect(inferPartnerHcpMin(history(['S', '2C']), 'S')).toBe(11);
    expect(inferPartnerHcpMin(history(['S', '2H']), 'S')).toBe(6);
    expect(inferPartnerHcpMin(history(['S', '3D']), 'S')).toBe(6);
  });

  it('同伴不是本副第一个实质叫牌人时不做推断', () => {
    // 东家先开叫 1D，南家随后争叫 1S：南家不是开叫人。
    expect(inferPartnerHcpMin(history(['E', '1D'], ['S', '1S']), 'S')).toBeUndefined();
  });

  it('竞争叫牌或非 1NT 应叫时不把再叫误读成 19+', () => {
    // 1C-(1S)-Pass-Pass-2H：对手争叫后的 2H 仍是自然 16+，不是 19+ 强再叫。
    expect(
      inferPartnerHcpMin(
        history(['S', '1C'], ['W', '1S'], ['N', 'Pass'], ['E', 'Pass'], ['S', '2H']),
        'S',
      ),
    ).toBe(16);
    // 1C-1D-2H：1D 负应后的 2H 暂按 16+ 保守处理。
    expect(
      inferPartnerHcpMin(
        history(['S', '1C'], ['W', 'Pass'], ['N', '1D'], ['E', 'Pass'], ['S', '2H']),
        'S',
      ),
    ).toBe(16);
  });

  it('满贯进程开始后仍保留 1C-1NT-2S 的 19+ 下限', () => {
    expect(
      inferPartnerHcpMin(
        history(
          ['S', '1C'], ['W', 'Pass'], ['N', '1NT'], ['E', 'Pass'],
          ['S', '2S'], ['W', 'Pass'], ['N', '4NT'], ['E', 'Pass'], ['S', '5H'],
        ),
        'S',
      ),
    ).toBe(19);
  });
});
