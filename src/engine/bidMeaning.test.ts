import { describe, expect, it } from 'vitest';
import {
  currentBidBefore,
  findCandidateForCall,
  genericCallMeaning,
  meaningForBidRecord,
  recommendedBidCandidate,
  sameBidCall,
} from './bidMeaning';
import { loadBiddingRules } from './loader';
import { parseHand } from '../testing/testUtils';
import type { BidRecord } from '../models/gameState';

const rules = loadBiddingRules('precision');

describe('叫牌含义与推荐', () => {
  it('推荐叫品取规则引擎最高优先级候选', () => {
    const hand = parseHand('SAKQ2 HAK3 D5432 C87'); // 16 HCP, 均型
    const candidate = recommendedBidCandidate(hand, [], 'S', null, 1, rules);
    expect(candidate?.call).toEqual({ type: 'bid', level: 1, suit: 'C' });
    expect(candidate?.rule.id).toBe('open_1c');
  });

  it('指定叫品能匹配到对应规则候选', () => {
    const hand = parseHand('SAKQ2 HAK3 D5432 C87');
    const candidate = findCandidateForCall(
      hand,
      [],
      'S',
      null,
      1,
      rules,
      { type: 'bid', level: 1, suit: 'C' },
    );
    expect(candidate?.rule.id).toBe('open_1c');
  });

  it('历史叫牌优先使用已保存的规则 id 展示说明', () => {
    const hand = parseHand('SAKQ2 HAK3 D5432 C87');
    const record: BidRecord = {
      position: 'S',
      call: { type: 'bid', level: 1, suit: 'C' },
      ruleId: 'open_1c',
    };
    expect(meaningForBidRecord(record, 0, [record], hand, 1, rules)).toContain('精确 1C 开叫');
  });

  it('没有规则 id 时按历史前缀重算；仍无匹配则给自然叫品说明', () => {
    const hand = parseHand('SAKQ2 HAK3 D5432 C87');
    const record: BidRecord = {
      position: 'S',
      call: { type: 'bid', level: 1, suit: 'C' },
    };
    expect(meaningForBidRecord(record, 0, [record], hand, 1, rules)).toContain('精确 1C 开叫');

    const pass: BidRecord = { position: 'S', call: { type: 'pass' } };
    expect(meaningForBidRecord(pass, 0, [pass], undefined, 1, rules)).toBe('不叫（Pass）');
  });

  it('当前叫品与叫品比较辅助函数正确', () => {
    expect(sameBidCall({ type: 'pass' }, { type: 'pass' })).toBe(true);
    expect(
      sameBidCall(
        { type: 'bid', level: 1, suit: 'C' },
        { type: 'bid', level: 1, suit: 'C' },
      ),
    ).toBe(true);
    expect(
      sameBidCall(
        { type: 'bid', level: 1, suit: 'C' },
        { type: 'bid', level: 1, suit: 'D' },
      ),
    ).toBe(false);
    expect(genericCallMeaning({ type: 'double' })).toContain('加倍');
  });

  it('按历史前缀找到叫牌前的当前叫品', () => {
    const history: BidRecord[] = [
      { position: 'N', call: { type: 'bid', level: 1, suit: 'C' } },
      { position: 'E', call: { type: 'pass' } },
      { position: 'S', call: { type: 'bid', level: 1, suit: 'H' } },
    ];
    expect(currentBidBefore(history, 1)).toEqual({ level: 1, suit: 'C' });
    expect(currentBidBefore(history, 3)).toEqual({ level: 1, suit: 'H' });
    expect(currentBidBefore(history, 0)).toBeNull();
  });
});
