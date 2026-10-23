import { describe, expect, it } from 'vitest';
import { history, parseHand } from '../../testing/testUtils';
import { loadBiddingRules } from '../../engine/loader';
import { findBidCandidates } from '../../engine/matcher';
import { buildAuctionConstraints, buildAuctionConstraintList } from './auctionInference';

const precision = loadBiddingRules('precision');
const styles = { N: 1, E: 1, S: 1, W: 1 } as const;

function hasRule(
  hand: string,
  records: ReturnType<typeof history>,
  position: 'N' | 'E' | 'S' | 'W',
  ruleId: string,
): boolean {
  const lastBid = [...records].reverse().find((record) => record.call.type === 'bid');
  const currentBid = lastBid?.call.type === 'bid'
    ? { level: lastBid.call.level, suit: lastBid.call.suit }
    : null;
  const candidates = findBidCandidates(
    parseHand(hand),
    records,
    position,
    currentBid,
    1,
    precision,
  );
  return candidates.some((candidate) => candidate.rule.id === ruleId);
}

describe('叫牌规则反推', () => {
  it('1NT 开叫约束接受 13-15 均型，拒绝弱牌', () => {
    const records = history(['N', '1NT'], ['E', 'Pass'], ['S', 'Pass'], ['W', 'Pass']);
    const constraints = buildAuctionConstraints(records, {
      rules: precision,
      styles,
      trustedSeats: ['N', 'E', 'S', 'W'],
    });
    expect(constraints.N).toBeDefined();
    expect(constraints.N!(parseHand('SAK2 HAQ3 D5432 CQ76'))).toBe(true); // 13 HCP
    expect(constraints.N!(parseHand('SJ32 H854 D7632 C932'))).toBe(false); // 1 HCP
  });

  it('人类座位可以被排除在推断之外', () => {
    const records = history(['N', '1C'], ['E', 'Pass'], ['S', '1H'], ['W', 'Pass']);
    const constraints = buildAuctionConstraintList(records, {
      rules: precision,
      styles,
      trustedSeats: ['N', 'E', 'W'],
    });
    expect(constraints.S).toBeUndefined();
    expect(constraints.N).toBeDefined();
  });

  it('同一叫品由宽规则产生时，不会被更具体但不适用的规则误杀', () => {
    // N 1C 后 S 1S，N 再叫 2C。N 实际 7 张梅花，
    // 既可能来自 opener_1c_1s_2c（6+ 梅花），也可能被
    // resp_1s_2c_natural 的序列误匹配；两者都必须保留为 OR。
    const records = history(
      ['N', '1C'],
      ['E', 'Pass'],
      ['S', '1S'],
      ['W', 'Pass'],
      ['N', '2C'],
    );
    const constraints = buildAuctionConstraints(records, {
      rules: precision,
      styles,
      trustedSeats: ['N', 'E', 'S', 'W'],
    });
    expect(constraints.N).toBeDefined();
    expect(constraints.N!(parseHand('SAK2 HAK3 D CQJT987'))).toBe(true); // 16 HCP, 7 梅花
  });

  it('响应 2NT 斯台曼后的 6H 规则使用正确的相对座位 token', () => {
    const records = history(
      ['N', '2NT'],
      ['E', 'Pass'],
      ['S', '3C'],
      ['W', 'Pass'],
      ['N', '3H'],
      ['E', 'Pass'],
    );
    // 13 HCP，4 张红桃；应能识别为 resp_2nt_stayman_h_6h。
    expect(hasRule('SAK2 HKQ32 D543 CQ87', records, 'S', 'resp_2nt_stayman_h_6h')).toBe(true);
  });

  it('1C-1H-1NT 后的 4H 规则使用正确的相对座位 token', () => {
    const records = history(
      ['N', '1C'],
      ['E', 'Pass'],
      ['S', '1H'],
      ['W', 'Pass'],
      ['N', '1NT'],
      ['E', 'Pass'],
    );
    expect(hasRule('S32 HKQJT98 D54 CA76', records, 'S', 'resp_1c_1h_1nt_4h')).toBe(true);
  });

  it('1C-2C-2S-3S 后开叫人能用 4S 进局', () => {
    const records = history(
      ['N', '1C'],
      ['E', 'Pass'],
      ['S', '2C'],
      ['W', 'Pass'],
      ['N', '2S'],
      ['E', 'Pass'],
      ['S', '3S'],
      ['W', 'Pass'],
    );
    expect(hasRule('SAKQ2 HAK3 D5432 C87', records, 'N', 'opener_1c_2c_2s_3s_4s')).toBe(true);
  });

  it('1NT-2C-2H 后应叫人能用 4H 进局', () => {
    const records = history(
      ['N', '1NT'],
      ['E', 'Pass'],
      ['S', '2C'],
      ['W', 'Pass'],
      ['N', '2H'],
      ['E', 'Pass'],
    );
    expect(hasRule('SAK2 HKQ32 D543 C876', records, 'S', 'resp_1nt_stayman_h_4h')).toBe(true);
  });

  it('1NT-2NT 邀叫后开叫人 15 点接受 3NT', () => {
    const records = history(
      ['N', '1NT'],
      ['E', 'Pass'],
      ['S', '2NT'],
      ['W', 'Pass'],
    );
    expect(hasRule('SAK2 HAQ3 D5432 CQ76', records, 'N', 'opener_1nt_2nt_3nt')).toBe(true);
  });

  it('1H-2C 后开叫人可用 2S 显示四张黑桃', () => {
    const records = history(
      ['N', '1H'],
      ['E', 'Pass'],
      ['S', '2C'],
      ['W', 'Pass'],
    );
    expect(hasRule('SAK32 HKQJ32 D54 C87', records, 'N', 'opener_1h_2c_2s')).toBe(true);
  });

  it('1S-2H 后开叫人可用 3H 显示红桃配合', () => {
    const records = history(
      ['N', '1S'],
      ['E', 'Pass'],
      ['S', '2H'],
      ['W', 'Pass'],
    );
    expect(hasRule('SAKQ32 HKQ32 D54 C87', records, 'N', 'opener_1s_2h_3h')).toBe(true);
  });

  it('1D-2C 后开叫人可用 2S 显示四张黑桃', () => {
    const records = history(
      ['N', '1D'],
      ['E', 'Pass'],
      ['S', '2C'],
      ['W', 'Pass'],
    );
    expect(hasRule('SAK32 HK3 DQJ32 C87', records, 'N', 'opener_1d_2c_2s')).toBe(true);
  });

  it('1H-2NT 邀叫后开叫人 14-15 均型接受 3NT', () => {
    const records = history(
      ['N', '1H'],
      ['E', 'Pass'],
      ['S', '2NT'],
      ['W', 'Pass'],
    );
    expect(hasRule('SAK2 HKQ32 D543 CQ76', records, 'N', 'opener_1h_2nt_3nt')).toBe(true);
  });

  it('2NT-4NT 定量邀叫后开叫人 21 点接受 6NT', () => {
    const records = history(
      ['N', '2NT'],
      ['E', 'Pass'],
      ['S', '4NT'],
      ['W', 'Pass'],
    );
    expect(hasRule('SAKQ HAQJ DK32 CQ765', records, 'N', 'opener_2nt_4nt_6nt')).toBe(true);
  });

  it('1NT-2D-2H-3H 邀叫后开叫人 15 点接受 4H', () => {
    const records = history(
      ['N', '1NT'],
      ['E', 'Pass'],
      ['S', '2D'],
      ['W', 'Pass'],
      ['N', '2H'],
      ['E', 'Pass'],
      ['S', '3H'],
      ['W', 'Pass'],
    );
    expect(hasRule('SAK2 HAQ3 D5432 CQ76', records, 'N', 'opener_transfer_h_3h_4h')).toBe(true);
  });

  it('1H 后 11-12 均型应叫 1NT 而不是 pass', () => {
    const records = history(['N', '1H'], ['E', 'Pass']);
    expect(hasRule('SA32 HK3 DQJ32 CQ765', records, 'S', 'resp_1h_1nt_invite')).toBe(true);
  });

  it('1H-1NT 后开叫人 14 点均型邀叫 2NT', () => {
    const records = history(
      ['N', '1H'],
      ['E', 'Pass'],
      ['S', '1NT'],
      ['W', 'Pass'],
    );
    expect(hasRule('SAK2 HKQ32 D543 CQ76', records, 'N', 'opener_1h_1nt_2nt')).toBe(true);
  });

  it('1H-1NT-2NT 后应叫人 11-12 接受 3NT', () => {
    const records = history(
      ['N', '1H'],
      ['E', 'Pass'],
      ['S', '1NT'],
      ['W', 'Pass'],
      ['N', '2NT'],
      ['E', 'Pass'],
    );
    expect(hasRule('SA32 HK3 DQJ32 CQ765', records, 'S', 'resp_1h_1nt_2nt_3nt')).toBe(true);
  });

  it('1D-1H 后开叫人可用 1S 显示四张黑桃', () => {
    const records = history(
      ['N', '1D'],
      ['E', 'Pass'],
      ['S', '1H'],
      ['W', 'Pass'],
    );
    expect(hasRule('SAK32 HK2 DQJ32 C87', records, 'N', 'opener_1d_1h_1s')).toBe(true);
  });

  it('1S 后 11-12 均型应叫 1NT', () => {
    const records = history(['N', '1S'], ['E', 'Pass']);
    expect(hasRule('SA3 HK32 DQJ32 CQ765', records, 'S', 'resp_1s_1nt_invite')).toBe(true);
  });

  it('1D-1S 后开叫人可用 2H 显示四张红桃', () => {
    const records = history(
      ['N', '1D'],
      ['E', 'Pass'],
      ['S', '1S'],
      ['W', 'Pass'],
    );
    expect(hasRule('SAQ3 HKJ32 DQJ3 C87', records, 'N', 'opener_1d_1s_2h')).toBe(true);
  });

  it('1C-1H-3H 后应叫人 13+ 用 4NT 问 A', () => {
    const records = history(
      ['N', '1C'],
      ['E', 'Pass'],
      ['S', '1H'],
      ['W', 'Pass'],
      ['N', '3H'],
      ['E', 'Pass'],
    );
    expect(hasRule('SAK2 HKQJ32 DQJ C87', records, 'S', 'blackwood_1c_1h_3h_ask')).toBe(true);
  });

  it('1C-1H-3H-4NT 后开叫人 2 A 答 5H', () => {
    const records = history(
      ['N', '1C'],
      ['E', 'Pass'],
      ['S', '1H'],
      ['W', 'Pass'],
      ['N', '3H'],
      ['E', 'Pass'],
      ['S', '4NT'],
      ['W', 'Pass'],
    );
    expect(hasRule('SAKQ2 HAQ32 DKQ C87', records, 'N', 'blackwood_1c_1h_3h_2')).toBe(true);
  });

  it('1C-1H-3H-4NT-5D 后应叫人 2 A 叫 6H', () => {
    const records = history(
      ['N', '1C'],
      ['E', 'Pass'],
      ['S', '1H'],
      ['W', 'Pass'],
      ['N', '3H'],
      ['E', 'Pass'],
      ['S', '4NT'],
      ['W', 'Pass'],
      ['N', '5D'],
      ['E', 'Pass'],
    );
    expect(hasRule('SAK2 HAQJ32 DQJ C87', records, 'S', 'blackwood_1c_1h_3h_5d_6h')).toBe(true);
  });

  it('1C-1S-3S 后应叫人 13+ 用 4NT 问 A', () => {
    const records = history(
      ['N', '1C'],
      ['E', 'Pass'],
      ['S', '1S'],
      ['W', 'Pass'],
      ['N', '3S'],
      ['E', 'Pass'],
    );
    expect(hasRule('SAKQ32 HK2 DQJ C87', records, 'S', 'blackwood_1c_1s_3s_ask')).toBe(true);
  });

  it('1C-1S-3S-4NT 后开叫人 3 A 答 5S', () => {
    const records = history(
      ['N', '1C'],
      ['E', 'Pass'],
      ['S', '1S'],
      ['W', 'Pass'],
      ['N', '3S'],
      ['E', 'Pass'],
      ['S', '4NT'],
      ['W', 'Pass'],
    );
    expect(hasRule('SAK32 HAQ2 DAQJ C876', records, 'N', 'blackwood_1c_1s_3s_3')).toBe(true);
  });
});
