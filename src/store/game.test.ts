import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useGameStore, vulName, PLAY_DISPLAY_MS } from './game';
import { parseAction } from '../core/bidding/validator';
import { getLegalCards } from '../core/playing';
import { getSuit } from '../models/card';
import { trumpSuitOf, type Position } from '../models/gameState';
import { sortHand } from '../models/hand';
import { parseHand } from '../testing/testUtils';
import { clearRuleOverrides } from '../engine/loader';

const SEATS: Position[] = ['N', 'E', 'S', 'W'];

function newStore() {
  setActivePinia(createPinia());
  return useGameStore();
}

describe('发牌与开局（用例 1、20）', () => {
  let store: ReturnType<typeof newStore>;
  beforeEach(() => {
    store = newStore();
  });

  it('发牌：52 张、每人 13 张、手牌已排序', () => {
    store.startNewGame({ autoStart: false, seed: 123 });
    let total = 0;
    for (const p of SEATS) {
      expect(store.hands[p].length).toBe(13);
      expect(store.hands[p]).toEqual(sortHand(store.hands[p]));
      total += store.hands[p].length;
    }
    expect(total).toBe(52);
    // 全局无重复
    const all = SEATS.flatMap((p) => store.hands[p]);
    expect(new Set(all).size).toBe(52);
  });

  it('局况为四种之一，庄家首局为 N', () => {
    store.startNewGame({ autoStart: false });
    expect(['none', 'NS', 'EW', 'both']).toContain(store.vulnerability);
    expect(store.dealer).toBe('N');
  });

  it('同一 seed 发牌可复现', () => {
    store.startNewGame({ autoStart: false, seed: 2024 });
    const first = SEATS.map((p) => [...store.hands[p]]);
    store.startNewGame({ autoStart: false, seed: 2024 });
    const second = SEATS.map((p) => [...store.hands[p]]);
    expect(second).toEqual(first);
  });

  it('新一局庄家顺时针轮转并清空状态', () => {
    store.startNewGame({ autoStart: false });
    expect(store.dealer).toBe('N');
    store.startNewGame({ autoStart: false });
    expect(store.dealer).toBe('E');
    expect(store.biddingHistory).toEqual([]);
    expect(store.tricks).toEqual([]);
    expect(store.contract).toBeNull();
    expect(store.score).toEqual({ NS: 0, EW: 0 });
  });
});

describe('叫牌结束判定（用例 5、6）', () => {
  let store: ReturnType<typeof newStore>;
  beforeEach(() => {
    store = newStore();
    store.startNewGame({ autoStart: false, seed: 7 });
  });

  it('四家 Pass 流局', () => {
    for (const p of SEATS) store.applyBid(p, { type: 'pass' });
    expect(store.checkBiddingEnd()).toBe('passed_out');
    expect(store.phase).toBe('scoring');
    expect(store.score).toEqual({ NS: 0, EW: 0 });
    expect(store.contract).toBeNull();
  });

  it('有叫品后连续三个 Pass 结束并确立定约', () => {
    store.applyBid('N', parseAction('1NT'));
    store.applyBid('E', { type: 'pass' });
    store.applyBid('S', { type: 'pass' });
    expect(store.checkBiddingEnd()).toBe('none'); // 仅两个 Pass
    store.applyBid('W', { type: 'pass' });
    expect(store.checkBiddingEnd()).toBe('contract');
    store.setContractAndStartPlay();
    expect(store.contract).toMatchObject({ level: 1, suit: 'NT', declarer: 'N', dummy: 'S' });
    expect(store.phase).toBe('play_waiting_lead');
    expect(store.nextPlayer).toBe('E'); // 庄家 N 的左手方
  });
});

describe('人类控制权模型（用例 14、15）', () => {
  let store: ReturnType<typeof newStore>;
  beforeEach(() => {
    store = newStore();
    store.startNewGame({ autoStart: false, seed: 1 });
  });

  it('叫牌阶段仅可操作自己', () => {
    expect(store.controlledSeats()).toEqual(['S']);
  });

  it('南做庄（北明手）：可操作庄家与明手', () => {
    store.contract = { level: 3, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' };
    expect(store.controlledSeats().sort()).toEqual(['N', 'S']);
  });

  it('南明手（北做庄）：可操作庄家与明手', () => {
    store.contract = { level: 4, suit: 'H', doubled: false, redoubled: false, declarer: 'N', dummy: 'S' };
    expect(store.controlledSeats().sort()).toEqual(['N', 'S']);
  });

  it('人类为防守方：只操作自己', () => {
    store.contract = { level: 2, suit: 'S', doubled: false, redoubled: false, declarer: 'E', dummy: 'W' };
    expect(store.controlledSeats()).toEqual(['S']);
  });
});

describe('唯一合法出牌自动进行', () => {
  it('自动出牌也至少展示 1 秒后才进行下一手', async () => {
    vi.useFakeTimers();
    try {
      const store = newStore();
      store.startNewGame({ autoStart: false, seed: 2 });
      store.contract = { level: 1, suit: 'NT', doubled: false, redoubled: false, declarer: 'N', dummy: 'S' };
      store.phase = 'play';
      store.tricks = [];
      store.currentTrick = [{ position: 'W', card: parseHand('H2')[0] }];
      store.nextPlayer = 'N';

      const onlyCard = parseHand('SA')[0];
      store.hands.N = [onlyCard];
      store.hands.E = [parseHand('H5')[0]]; // 东家同样只有一张合法牌，也应自动出牌
      store.hands.S = parseHand('H3 H4'); // 轮到人类时有两张合法牌，循环应停下

      const loop = store.runAILoop();
      await vi.advanceTimersByTimeAsync(0);

      // 本墩还没有上一张牌，北家的唯一合法牌立即打出
      expect(store.hands.N).toEqual([]);
      expect(store.currentTrick.find((p) => p.position === 'N')?.card).toBe(onlyCard);

      // 东家的自动出牌必须等北家的牌展示满 1 秒
      await vi.advanceTimersByTimeAsync(PLAY_DISPLAY_MS - 1);
      expect(store.currentTrick.find((p) => p.position === 'E')).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(store.currentTrick.find((p) => p.position === 'E')?.card).toBe(parseHand('H5')[0]);

      // 东家的牌同样展示满 1 秒后才把控制权交还人类
      expect(store.nextPlayer).toBe('S');
      expect(store.isAiThinking).toBe(true);
      await vi.advanceTimersByTimeAsync(PLAY_DISPLAY_MS);
      await loop;

      expect(store.isAiThinking).toBe(false);
      expect(store.nextPlayer).toBe('S');
      expect(store.currentTrick.find((p) => p.position === 'S')).toBeUndefined();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});

describe('打牌全流程与计分（用例 13、16、17、18）', () => {
  let store: ReturnType<typeof newStore>;
  beforeEach(() => {
    store = newStore();
  });

  it('首攻后立即摊牌；13 墩结束并计分', () => {
    store.startNewGame({ autoStart: false, seed: 55 });
    // 构造定约：N 1NT，其余 Pass
    store.applyBid('N', parseAction('1NT'));
    store.applyBid('E', { type: 'pass' });
    store.applyBid('S', { type: 'pass' });
    store.applyBid('W', { type: 'pass' });
    expect(store.checkBiddingEnd()).toBe('contract');
    store.setContractAndStartPlay();

    expect(store.dummyOpen).toBe(false);
    // 首攻
    const leader = store.nextPlayer!;
    const trump = trumpSuitOf(store.contract!);
    const leadCard = getLegalCards(store.hands[leader], null, trump)[0];
    store.applyPlay(leader, leadCard);
    expect(store.dummyOpen).toBe(true); // 明手摊牌时机

    // 打完全部 52 张
    let guard = 0;
    while ((store.phase === 'play' || store.phase === 'play_waiting_lead') && guard++ < 60) {
      const pos = store.nextPlayer!;
      const hand = store.hands[pos];
      const leadSuit = store.currentTrick.length === 0 ? null : getSuit(store.currentTrick[0].card);
      const legal = getLegalCards(hand, leadSuit, trumpSuitOf(store.contract!));
      store.applyPlay(pos, legal[0]);
    }

    expect(store.tricks.length).toBe(13);
    expect(store.phase).toBe('scoring');
    for (const p of SEATS) expect(store.hands[p].length).toBe(0);
    // 每墩赢家统计与计分一致：定约 N（南北），无局/有局按局况
    const declSideWon = store.tricks.filter((t) => t.winner === 'N' || t.winner === 'S').length;
    expect(store.declarerTricksWon()).toBe(declSideWon);
    expect(store.score.NS + store.score.EW).toBeGreaterThan(0);
  });
});

describe('对局历史归档', () => {
  it('新一局开始时归档上一局的叫牌与出牌过程', () => {
    const store = newStore();
    store.startNewGame({ autoStart: false, seed: 1 });
    store.applyBid('N', parseAction('1NT'));
    store.applyBid('E', { type: 'pass' });
    store.applyBid('S', { type: 'pass' });
    store.applyBid('W', { type: 'pass' });
    store.setContractAndStartPlay();
    const leader = store.nextPlayer!;
    const trump = trumpSuitOf(store.contract!);
    store.applyPlay(leader, getLegalCards(store.hands[leader], null, trump)[0]);

    expect(store.dealHistory).toHaveLength(0);
    store.startNewGame({ autoStart: false, seed: 2 });
    expect(store.dealHistory).toHaveLength(1);
    const rec = store.dealHistory[0];
    expect(rec.index).toBe(1);
    expect(rec.biddingHistory).toHaveLength(4);
    expect(rec.contract).toMatchObject({ level: 1, suit: 'NT', declarer: 'N' });
    expect(rec.tricks).toHaveLength(0);
    expect(rec.currentTrick).toHaveLength(1);
  });

  it('未开始叫牌的对局不产生归档', () => {
    const store = newStore();
    store.startNewGame({ autoStart: false, seed: 1 });
    store.startNewGame({ autoStart: false, seed: 2 });
    expect(store.dealHistory).toHaveLength(0);
  });
});

describe('局况英文名称', () => {
  it('返回 Both / EW / None / NS', () => {
    expect(vulName('both')).toBe('Both');
    expect(vulName('EW')).toBe('EW');
    expect(vulName('none')).toBe('None');
    expect(vulName('NS')).toBe('NS');
  });
});

describe('计点（IMP）胜负汇总', () => {
  /** 模拟一局完成结算（带定约以保证会被归档）；默认双方各 20 点 → 贴点为 0 */
  function completeDeal(
    store: ReturnType<typeof newStore>,
    NS: number,
    EW: number,
    hcpSides: { NS: number; EW: number } = { NS: 20, EW: 20 },
  ): void {
    store.contract = { level: 1, suit: 'NT', doubled: false, redoubled: false, declarer: 'S', dummy: 'N' };
    store.phase = 'scoring';
    store.score = { NS, EW };
    store.dealHcp = { ...hcpSides };
  }

  it('本局点数按标准表换算，并累加进本循环', () => {
    const store = newStore();
    store.startNewGame({ autoStart: false, seed: 1 });

    // 结算第 1 局：NS +420 → 9 点
    completeDeal(store, 420, 0);
    expect(store.pointsSummary.dealPoints).toBe(9);
    expect(store.pointsSummary.roundNS).toBe(9);
    expect(store.pointsSummary.roundEW).toBe(0);
    expect(store.pointsSummary.roundDiff).toBe(9);
    expect(store.pointsSummary.dealsPlayed).toBe(1);

    // 新一局：归档第 1 局，本局未结算
    store.startNewGame({ autoStart: false, seed: 2 });
    expect(store.pointsSummary.dealPoints).toBe(0);
    expect(store.pointsSummary.roundNS).toBe(9);
    expect(store.pointsSummary.dealsPlayed).toBe(1);

    // 结算第 2 局：EW +100 → 3 点
    completeDeal(store, 0, 100);
    expect(store.pointsSummary.dealPoints).toBe(-3);
    expect(store.pointsSummary.roundNS).toBe(9);
    expect(store.pointsSummary.roundEW).toBe(3);
    expect(store.pointsSummary.roundDiff).toBe(6);
    expect(store.pointsSummary.dealsPlayed).toBe(2);
  });

  it('按循环长度分段：满 8 副后进入下一循环并从零累计', () => {
    const store = newStore();
    store.setRoundSize(8);
    for (let g = 1; g <= 8; g++) {
      store.startNewGame({ autoStart: false, seed: g });
      completeDeal(store, 420, 0);
    }
    // 第 1 循环满 8 副
    expect(store.pointsSummary.roundNumber).toBe(1);
    expect(store.pointsSummary.dealsPlayed).toBe(8);
    expect(store.pointsSummary.roundNS).toBe(72);

    store.startNewGame({ autoStart: false, seed: 99 });
    expect(store.pointsSummary.roundNumber).toBe(2);
    expect(store.pointsSummary.dealsPlayed).toBe(0);
    expect(store.pointsSummary.roundNS).toBe(0);
    expect(store.pointsSummary.roundDiff).toBe(0);
  });

  it('未结算的对局不计入点数', () => {
    const store = newStore();
    store.startNewGame({ autoStart: false, seed: 4 });
    expect(store.pointsSummary.dealPoints).toBe(0);
    expect(store.pointsSummary.dealsPlayed).toBe(0);
    expect(store.pointsSummary.roundDiff).toBe(0);
  });

  it('循环长度可切换为 16 副', () => {
    const store = newStore();
    store.setRoundSize(16);
    expect(store.roundSize).toBe(16);
    store.setRoundSize(8);
    expect(store.roundSize).toBe(8);
  });

  it('默认启用贴点：本副点数 = IMP −（胜方大牌点 − 20）', () => {
    const store = newStore();
    store.startNewGame({ autoStart: false, seed: 1 });
    expect(store.useHcpAdjust).toBe(true);

    // 南北 26 点做成 3NT 得 400 → 9 IMP −（26 − 20）= 3
    completeDeal(store, 420, 0, { NS: 26, EW: 14 });
    expect(store.pointsSummary.dealImp).toBe(9);
    expect(store.pointsSummary.dealAdjust).toBe(-6);
    expect(store.pointsSummary.dealPoints).toBe(3);
    expect(store.pointsSummary.dealHcp).toEqual({ NS: 26, EW: 14 });
    expect(store.pointsSummary.roundNS).toBe(3);
    expect(store.pointsSummary.roundDiff).toBe(3);
  });

  it('贴点可把高牌胜方倒扣为负（低点进局受奖励）', () => {
    const store = newStore();
    store.startNewGame({ autoStart: false, seed: 1 });
    // 南北 34 点仅得 400（9 IMP）→ 9 −（34 − 20）= −5 → 实际 EW 得 5
    completeDeal(store, 420, 0, { NS: 34, EW: 6 });
    expect(store.pointsSummary.dealPoints).toBe(-5);
    expect(store.pointsSummary.roundNS).toBe(0);
    expect(store.pointsSummary.roundEW).toBe(5);
    expect(store.pointsSummary.roundDiff).toBe(-5);

    // 东家 12 点赢 3 IMP → EW 调整后 |3| −（12 − 20）= 11（NS 视角 −11）
    const store2 = newStore();
    store2.startNewGame({ autoStart: false, seed: 2 });
    completeDeal(store2, 0, 100, { NS: 28, EW: 12 });
    expect(store2.pointsSummary.dealPoints).toBe(-11);
  });

  it('关闭贴点时退回原始 IMP', () => {
    const store = newStore();
    store.startNewGame({ autoStart: false, seed: 1 });
    store.setUseHcpAdjust(false);
    completeDeal(store, 420, 0, { NS: 26, EW: 14 });
    expect(store.pointsSummary.dealPoints).toBe(9);
    expect(store.pointsSummary.dealAdjust).toBe(0);
    expect(store.pointsSummary.roundNS).toBe(9);
  });

  it('归档后仍保留双方大牌点，切换开关可重算历史', () => {
    const store = newStore();
    store.startNewGame({ autoStart: false, seed: 1 });
    completeDeal(store, 420, 0, { NS: 26, EW: 14 });
    store.startNewGame({ autoStart: false, seed: 2 }); // 归档第 1 局

    expect(store.dealHistory[0].hcp).toEqual({ NS: 26, EW: 14 });
    expect(store.pointsSummary.roundNS).toBe(3);

    store.setUseHcpAdjust(false);
    expect(store.pointsSummary.roundNS).toBe(9);
  });

  it('流局：由大牌点多的一方贴点计负', () => {
    const store = newStore();
    store.startNewGame({ autoStart: false, seed: 1 });
    store.contract = null;
    store.phase = 'scoring';
    store.score = { NS: 0, EW: 0 };
    store.dealHcp = { NS: 26, EW: 14 };

    expect(store.pointsSummary.dealImp).toBe(0);
    expect(store.pointsSummary.dealPoints).toBe(-6);
    expect(store.pointsSummary.roundNS).toBe(0);
    expect(store.pointsSummary.roundEW).toBe(6);
    expect(store.pointsSummary.roundDiff).toBe(-6);
  });
});

describe('规则文件可替换（用例 19）', () => {  it('切换叫牌体系会替换引擎规则集', () => {
    const store = newStore();
    store.startNewGame({ autoStart: false, seed: 3 });
    expect(store.biddingRuleFile.name).toBe('precision');
    expect(store.biddingRules.rules.some((r) => r.id === 'open_2c_precision')).toBe(true);

    store.setBiddingRuleFile('natural');
    expect(store.biddingRuleFile.name).toBe('natural');
    expect(store.biddingRules.rules.some((r) => r.id === 'open_2c_precision')).toBe(false);
    expect(store.biddingRules.rules.some((r) => r.id === 'open_2c_strong')).toBe(true);
  });
});

describe('人类叫牌自由度（用例 3）', () => {
  it('人类可无视点力条件诈叫（仅受法律约束）', () => {
    vi.useFakeTimers();
    try {
      const store = newStore();
      store.startNewGame({ autoStart: false, seed: 11 });
      store.applyBid('N', { type: 'pass' });
      store.applyBid('E', { type: 'pass' }); // 轮到南家（人类）
      expect(store.currentBidder).toBe('S');

      void store.humanBid(parseAction('1C')); // 任意点数均可开叫
      const last = store.biddingHistory.at(-1)!;
      expect(last.position).toBe('S');
      expect(last.call).toEqual({ type: 'bid', level: 1, suit: 'C' });
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('人类非法叫品被拒绝（低于当前叫品）', () => {
    vi.useFakeTimers();
    try {
      const store = newStore();
      store.startNewGame({ autoStart: false, seed: 11 });
      store.applyBid('N', parseAction('1S')); // 北开叫 1S
      store.applyBid('E', { type: 'pass' });
      const before = store.biddingHistory.length;
      void store.humanBid(parseAction('1H')); // 非法：低于 1S
      expect(store.biddingHistory.length).toBe(before);
      expect(store.message).toContain('不合法');
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('上家叫 1♣ 后，人类可以叫同阶更高的 1♠', async () => {
    vi.useFakeTimers();
    try {
      const store = newStore();
      store.startNewGame({ autoStart: false, seed: 11 });
      store.applyBid('N', parseAction('1C'));
      store.applyBid('E', { type: 'pass' });
      expect(store.currentBid).toEqual({ level: 1, suit: 'C' });
      expect(store.currentBidder).toBe('S');

      void store.humanBid(parseAction('1S'));
      const last = store.biddingHistory.at(-1)!;
      expect(last.position).toBe('S');
      expect(last.call).toEqual({ type: 'bid', level: 1, suit: 'S' });
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});

describe('全机器自动托管（端到端）', () => {
  it('开启托管后，AI 循环可自动跑完整局并结算', async () => {
    vi.useFakeTimers();
    try {
      const store = newStore();
      store.setAutoPilot(true);
      store.startNewGame({ seed: 42 }); // autoStart 默认开启

      for (let i = 0; i < 400 && store.phase !== 'scoring'; i++) {
        await vi.advanceTimersByTimeAsync(900);
      }

      expect(store.phase).toBe('scoring');
      if (store.contract) {
        expect(store.tricks.length).toBe(13);
        expect(store.tricks.every((t) => t.plays.length === 4)).toBe(true);
      } else {
        // 流局
        expect(store.score).toEqual({ NS: 0, EW: 0 });
      }
      expect(store.isAiThinking).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('自动托管跑多局不报错', async () => {
    vi.useFakeTimers();
    try {
      const store = newStore();
      store.setAutoPilot(true);
      for (let g = 0; g < 3; g++) {
        store.startNewGame({ seed: 1000 + g });
        for (let i = 0; i < 400 && store.phase !== 'scoring'; i++) {
          await vi.advanceTimersByTimeAsync(900);
        }
        expect(store.phase).toBe('scoring');
      }
      expect(store.dealer).toBe('S'); // 3 局：N → E → S
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('规则浏览 / 修改', () => {
  it('保存并应用修改后的叫牌规则，恢复默认可回退', () => {
    clearRuleOverrides();
    const store = newStore();
    const original = store.getRuleSource('bidding', 'precision');
    const modified = original.replace('action: "1C"', 'action: "2C"');
    expect(modified).not.toBe(original);

    store.saveRuleSource('bidding', 'precision', modified);
    expect(store.isRuleOverridden('bidding', 'precision')).toBe(true);
    expect(store.biddingRules.rules.find((r) => r.id === 'open_1c')?.action).toBe('2C');

    store.resetRuleSource('bidding', 'precision');
    expect(store.isRuleOverridden('bidding', 'precision')).toBe(false);
    expect(store.biddingRules.rules.find((r) => r.id === 'open_1c')?.action).toBe('1C');
    clearRuleOverrides();
  });

  it('首攻规则可保存并应用；非法源码被校验拦截', () => {
    clearRuleOverrides();
    const store = newStore();
    const original = store.getRuleSource('lead', 'leads');
    const modified = original.replace('lead: "top_of_sequence"', 'lead: "4th_best_of_longest"');
    store.saveRuleSource('lead', 'leads', modified);
    expect(store.leadRules.rules.find((r) => r.id === 'suit_honor_sequence')?.lead).toBe(
      '4th_best_of_longest',
    );

    expect(store.validateRuleSource('bidding', 'foo: bar').ok).toBe(false);
    expect(() => store.saveRuleSource('bidding', 'precision', 'foo: bar')).toThrow();

    store.resetRuleSource('lead', 'leads');
    clearRuleOverrides();
  });

  it('当前阶段所有用户均可编辑规则', () => {
    const store = newStore();
    expect(store.currentUserRole).toBe('user');
    expect(store.canEditRules).toBe(true);
  });
});
