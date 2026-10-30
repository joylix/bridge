/**
 * 无界面牌桌 reducer（Sprint 1 第一版）。
 *
 * 目标：把叫牌 / 出牌 / 结算从 Pinia store 中独立出来，供服务端、回放器
 * 与单机适配层共用。所有函数不读取 store、不访问 UI、不修改输入状态。
 *
 * 事件草稿由 reducer 产出，`EventLog` 负责补 eventId / seq / at。
 */

import type {
  BidCall,
  BidRecord,
  BidSuit,
  CardPlay,
  Contract,
  Position,
  Trick,
} from '../../models/gameState';
import { getSide, nextPosition, trumpSuitOf } from '../../models/gameState';
import type { Hand } from '../../models/hand';
import { getSuit } from '../../models/card';
import { auctionOutcome, contractFromAuction } from '../../core/auction';
import { isCallLegal } from '../../core/bidding/validator';
import { isCardLegal } from '../../core/playing';
import { determineTrickWinner } from '../../core/trick';
import { computeScore } from '../../core/scoring';
import { impsFromScoreDiff } from '../../core/imps';
import type { TableEventDraft } from '../events/types';

export type TablePhase =
  | 'bidding'
  | 'play_waiting_lead'
  | 'play'
  | 'completed'
  | 'passed_out';

export type TableVulnerability = 'none' | 'NS' | 'EW' | 'both';

export interface BoardSettlement {
  status: 'PLAYED' | 'PASSED_OUT';
  nsRaw: number;
  score: { NS: number; EW: number };
  tricksTaken: number;
  singleTableImp: number;
}

export interface TableState {
  phase: TablePhase;
  dealer: Position;
  vulnerability: TableVulnerability;
  hands: Record<Position, Hand>;
  biddingHistory: BidRecord[];
  currentBid: { level: number; suit: BidSuit } | null;
  doubleState: 'none' | 'double' | 'redouble';
  currentBidder: Position;
  contract: Contract | null;
  tricks: Trick[];
  currentTrick: CardPlay[];
  trickLeader: Position | null;
  nextPlayer: Position | null;
  dummyOpen: boolean;
  score: { NS: number; EW: number };
  tricksTaken: number;
  settlement: BoardSettlement | null;
}

export type TableErrorCode =
  | 'PHASE_INVALID'
  | 'NOT_YOUR_TURN'
  | 'BID_ILLEGAL'
  | 'PLAY_ILLEGAL'
  | 'CARD_NOT_IN_HAND';

export interface TableError {
  code: TableErrorCode;
  message: string;
}

export interface TableTransition {
  state: TableState;
  events: TableEventDraft[];
  error?: TableError;
}

export type TableAction =
  | {
      type: 'call';
      position: Position;
      call: BidCall;
      meta?: { alerted?: boolean; alertText?: string; ruleId?: string };
    }
  | { type: 'play'; position: Position; card: number }
  | { type: 'settle' };

export interface TableInit {
  dealer: Position;
  vulnerability: TableVulnerability;
  hands: Record<Position, Hand>;
}

export function createTableState(init: TableInit): TableState {
  return {
    phase: 'bidding',
    dealer: init.dealer,
    vulnerability: init.vulnerability,
    hands: {
      N: [...init.hands.N],
      E: [...init.hands.E],
      S: [...init.hands.S],
      W: [...init.hands.W],
    },
    biddingHistory: [],
    currentBid: null,
    doubleState: 'none',
    currentBidder: init.dealer,
    contract: null,
    tricks: [],
    currentTrick: [],
    trickLeader: null,
    nextPlayer: null,
    dummyOpen: false,
    score: { NS: 0, EW: 0 },
    tricksTaken: 0,
    settlement: null,
  };
}

/** 已完成的墩 → 合约分、原始分与 IMP。 */
export function settleBoard(
  contract: Contract | null,
  tricks: readonly Trick[],
  vulnerability: TableVulnerability,
): BoardSettlement {
  if (!contract) {
    return {
      status: 'PASSED_OUT',
      nsRaw: 0,
      score: { NS: 0, EW: 0 },
      tricksTaken: 0,
      singleTableImp: 0,
    };
  }
  const side = getSide(contract.declarer);
  const tricksTaken = tricks.filter((trick) => getSide(trick.winner) === side).length;
  const score = computeScore(contract, tricksTaken, vulnerability);
  const nsRaw = score.NS - score.EW;
  return {
    status: 'PLAYED',
    nsRaw,
    score: { NS: score.NS, EW: score.EW },
    tricksTaken,
    singleTableImp: impsFromScoreDiff(nsRaw),
  };
}

function fail(state: TableState, code: TableErrorCode, message: string): TableTransition {
  return { state, events: [], error: { code, message } };
}

function completedEvents(settlement: BoardSettlement): TableEventDraft[] {
  return [
    {
      type: 'board.completed',
      payload: {
        status: settlement.status,
        nsRaw: settlement.nsRaw,
        tricksTaken: settlement.tricksTaken,
      },
    },
    {
      type: 'score.computed',
      payload: {
        nsRaw: settlement.nsRaw,
        singleTableImp: settlement.singleTableImp,
        tableVersion: 'wbf-2017',
      },
    },
  ];
}

function reduceCall(
  state: TableState,
  action: Extract<TableAction, { type: 'call' }>,
): TableTransition {
  if (state.phase !== 'bidding') {
    return fail(state, 'PHASE_INVALID', `当前阶段 ${state.phase} 不能叫牌`);
  }
  if (action.position !== state.currentBidder) {
    return fail(
      state,
      'NOT_YOUR_TURN',
      `轮到 ${state.currentBidder}，不能由 ${action.position} 叫牌`,
    );
  }
  if (!isCallLegal(state.biddingHistory, state.currentBid, action.position, action.call)) {
    return fail(state, 'BID_ILLEGAL', `${action.position} 的 ${action.call.type} 不合法`);
  }

  const record: BidRecord = {
    position: action.position,
    call: action.call,
    ...(action.meta?.alerted ? { alerted: true, alertText: action.meta.alertText } : {}),
    ...(action.meta?.ruleId ? { ruleId: action.meta.ruleId } : {}),
  };
  const biddingHistory = [...state.biddingHistory, record];
  let currentBid = state.currentBid;
  let doubleState = state.doubleState;
  if (action.call.type === 'bid') {
    currentBid = { level: action.call.level, suit: action.call.suit };
    doubleState = 'none';
  } else if (action.call.type === 'double') {
    doubleState = 'double';
  } else if (action.call.type === 'redouble') {
    doubleState = 'redouble';
  }

  const currentBidder = nextPosition(action.position);
  const outcome = auctionOutcome(biddingHistory, currentBid);
  const events: TableEventDraft[] = [
    {
      type: 'auction.call',
      payload: {
        position: action.position,
        call: action.call,
        ...(action.meta?.ruleId ? { ruleId: action.meta.ruleId } : {}),
        ...(action.meta?.alerted
          ? { alerted: true, alertText: action.meta.alertText }
          : {}),
      },
    },
  ];

  if (outcome === 'passed_out') {
    const settlement = settleBoard(null, [], state.vulnerability);
    return {
      state: {
        ...state,
        phase: 'passed_out',
        biddingHistory,
        currentBid,
        doubleState,
        currentBidder,
        score: settlement.score,
        tricksTaken: 0,
        settlement,
      },
      events: [...events, ...completedEvents(settlement)],
    };
  }

  if (outcome === 'contract') {
    const contract = contractFromAuction(biddingHistory, currentBid, doubleState);
    if (!contract) {
      return fail(state, 'BID_ILLEGAL', '叫牌结束但无法确立定约');
    }
    const leader = nextPosition(contract.declarer);
    return {
      state: {
        ...state,
        phase: 'play_waiting_lead',
        biddingHistory,
        currentBid,
        doubleState,
        currentBidder,
        contract,
        trickLeader: leader,
        nextPlayer: leader,
      },
      events: [
        ...events,
        {
          type: 'contract.set',
          payload: { contract, declarer: contract.declarer, tricksTaken: 0 },
        },
      ],
    };
  }

  return {
    state: {
      ...state,
      phase: 'bidding',
      biddingHistory,
      currentBid,
      doubleState,
      currentBidder,
    },
    events,
  };
}

function reducePlay(
  state: TableState,
  action: Extract<TableAction, { type: 'play' }>,
): TableTransition {
  if (state.phase !== 'play' && state.phase !== 'play_waiting_lead') {
    return fail(state, 'PHASE_INVALID', `当前阶段 ${state.phase} 不能出牌`);
  }
  if (!state.contract) {
    return fail(state, 'PHASE_INVALID', '没有定约，不能出牌');
  }
  if (action.position !== state.nextPlayer) {
    return fail(
      state,
      'NOT_YOUR_TURN',
      `轮到 ${String(state.nextPlayer)}，不能由 ${action.position} 出牌`,
    );
  }
  const hand = state.hands[action.position];
  if (!hand.includes(action.card)) {
    return fail(state, 'CARD_NOT_IN_HAND', `${action.position} 手中没有该牌`);
  }
  const leadSuit = state.currentTrick.length === 0 ? null : getSuit(state.currentTrick[0].card);
  if (!isCardLegal(action.card, hand, leadSuit)) {
    return fail(state, 'PLAY_ILLEGAL', `${action.position} 必须跟出领出花色`);
  }

  const hands = { ...state.hands, [action.position]: hand.filter((card) => card !== action.card) };
  const currentTrick = [...state.currentTrick, { position: action.position, card: action.card }];
  const events: TableEventDraft[] = [
    { type: 'play.card', payload: { position: action.position, card: action.card } },
  ];

  if (currentTrick.length < 4) {
    return {
      state: {
        ...state,
        phase: 'play',
        hands,
        currentTrick,
        nextPlayer: nextPosition(action.position),
        dummyOpen: true,
      },
      events,
    };
  }

  const trickLeader = state.trickLeader ?? action.position;
  const winner = determineTrickWinner(currentTrick, trumpSuitOf(state.contract));
  const trick: Trick = { plays: currentTrick, leader: trickLeader, winner };
  const tricks = [...state.tricks, trick];
  events.push({
    type: 'trick.completed',
    payload: { index: tricks.length, leader: trickLeader, winner, cards: currentTrick },
  });

  if (tricks.length === 13) {
    const settlement = settleBoard(state.contract, tricks, state.vulnerability);
    return {
      state: {
        ...state,
        phase: 'completed',
        hands,
        tricks,
        currentTrick: [],
        trickLeader: null,
        nextPlayer: null,
        dummyOpen: true,
        score: settlement.score,
        tricksTaken: settlement.tricksTaken,
        settlement,
      },
      events: [...events, ...completedEvents(settlement)],
    };
  }

  return {
    state: {
      ...state,
      phase: 'play_waiting_lead',
      hands,
      tricks,
      currentTrick: [],
      trickLeader: winner,
      nextPlayer: winner,
      dummyOpen: true,
    },
    events,
  };
}

function reduceSettle(state: TableState): TableTransition {
  if (state.phase === 'completed' || state.phase === 'passed_out') {
    return { state, events: [] };
  }
  if (!state.contract || state.tricks.length !== 13) {
    return fail(state, 'PHASE_INVALID', '只有 13 墩全部完成或流局时才能结算');
  }
  const settlement = settleBoard(state.contract, state.tricks, state.vulnerability);
  return {
    state: {
      ...state,
      phase: 'completed',
      score: settlement.score,
      tricksTaken: settlement.tricksTaken,
      settlement,
    },
    events: completedEvents(settlement),
  };
}

/** 纯 reducer：相同输入 + 相同 action 必得相同状态与事件。 */
export function reduceTable(state: TableState, action: TableAction): TableTransition {
  switch (action.type) {
    case 'call':
      return reduceCall(state, action);
    case 'play':
      return reducePlay(state, action);
    case 'settle':
      return reduceSettle(state);
  }
}
