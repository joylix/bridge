import type { Hand } from './hand';
import type { SuitIndex } from './card';

/** 座位（顺时针：N → E → S → W） */
export type Position = 'N' | 'E' | 'S' | 'W';

export type BidSuit = 'C' | 'D' | 'H' | 'S' | 'NT';

export type BidCall =
  | { type: 'pass' }
  | { type: 'bid'; level: number; suit: BidSuit }
  | { type: 'double' }
  | { type: 'redouble' };

export interface BidRecord {
  position: Position;
  call: BidCall;
  /** 该叫牌通过“确认+提醒”提交（叫牌表以白底突出，不弹提醒框） */
  alerted?: boolean;
  /** 提醒内容（如“约定叫”），仅供悬停查看 */
  alertText?: string;
  /** 产生该叫品的规则 id；用于在叫牌含义浮窗中稳定展示规则说明 */
  ruleId?: string;
}

export interface Contract {
  level: number;
  suit: BidSuit;
  doubled: boolean;
  redoubled: boolean;
  declarer: Position; // 庄家
  dummy: Position; // 明手
}

export interface CardPlay {
  position: Position;
  card: number;
}

export interface Trick {
  plays: CardPlay[]; // 恰好 4 张（按出牌顺序）
  leader: Position;
  winner: Position;
}

export type GamePhase = 'idle' | 'bidding' | 'play_waiting_lead' | 'play' | 'scoring';

/** 风格档位：0=保守，1=正常，2=激进 */
export type StyleLevel = 0 | 1 | 2;

/** 每个座位的机器人配置（冻结接口） */
export interface SeatStyle {
  bid: StyleLevel; // 叫牌风格
  play: StyleLevel; // 打牌风格
  randomness: number; // [0,1] 探索概率
}

export interface GameState {
  phase: GamePhase;
  dealer: Position;
  vulnerability: 'none' | 'NS' | 'EW' | 'both';
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
  message: string;
  isAiThinking: boolean;
  // —— 人类控制模型（冻结）——
  humanSeats: Position[];
  styles: Record<Position, SeatStyle>;
  rngSeed: number;
}

/* ------------------------------------------------------------------ *
 * 方向辅助函数（冻结）
 * ------------------------------------------------------------------ */

export const ORDER: Position[] = ['N', 'E', 'S', 'W'];

export function nextPosition(pos: Position): Position {
  const idx = ORDER.indexOf(pos);
  return ORDER[(idx + 1) % 4];
}

export function getPartner(pos: Position): Position {
  const idx = ORDER.indexOf(pos);
  return ORDER[(idx + 2) % 4];
}

export function getSide(pos: Position): 'NS' | 'EW' {
  return pos === 'N' || pos === 'S' ? 'NS' : 'EW';
}

/**
 * 当前对人类开放的“可操作座位”集合（冻结接口）。
 * - 若人类所在方为定约方：人类同时操作庄家与明手两张手牌；
 * - 否则：人类只操作自己的座位。
 */
export function controllableSeats(state: Pick<GameState, 'contract' | 'humanSeats'>): Position[] {
  if (!state.contract) return [...state.humanSeats];
  const declSide = getSide(state.contract.declarer);
  const humanOnDeclSide = state.humanSeats.some((p) => getSide(p) === declSide);
  return humanOnDeclSide ? [state.contract.declarer, state.contract.dummy] : [...state.humanSeats];
}

/* ------------------------------------------------------------------ *
 * 定约 ⇄ 花色索引映射
 * ------------------------------------------------------------------ */

const BID_SUIT_TO_INDEX: Record<BidSuit, SuitIndex> = { C: 0, D: 1, H: 2, S: 3, NT: 0 };

/** 定约将牌花色索引；无将（NT）返回 null */
export function trumpSuitOf(contract: Contract): SuitIndex | null {
  if (contract.suit === 'NT') return null;
  return BID_SUIT_TO_INDEX[contract.suit];
}

/** 叫品花色转普通花色索引（NT 无意义，按梅花处理） */
export function bidSuitToIndex(suit: BidSuit): SuitIndex {
  return BID_SUIT_TO_INDEX[suit];
}
