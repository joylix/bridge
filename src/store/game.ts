import { defineStore } from 'pinia';
import { toRefs, reactive, ref, computed } from 'vue';
import type {
  BidCall,
  BidRecord,
  BidSuit,
  CardPlay,
  Contract,
  GamePhase,
  GameState,
  Position,
  SeatStyle,
  StyleLevel,
  Trick,
} from '../models/gameState';
import { getPartner, getSide, nextPosition, trumpSuitOf } from '../models/gameState';
import type { Hand } from '../models/hand';
import { createDeck, deal, shuffle } from '../core/deck';
import { sortHand } from '../models/hand';
import { getSuit } from '../models/card';
import { isCallLegal } from '../core/bidding/validator';
import { getLegalCards, isCardLegal } from '../core/playing';
import { determineTrickWinner } from '../core/trick';
import { computeScore, type ScoreResult } from '../core/scoring';
import { hcpAdjustedPoints, impsFromScoreDiff } from '../core/imps';
import { hcp } from '../core/evaluate';
import { bidAI } from '../ai/bidAI';
import { playAI } from '../ai/playAI';
import type { BiddingRule, LeadRule } from '../engine/types';
import { makeRng } from '../engine/arbiter';
import {
  clearRuleOverrides,
  getBiddingRuleText,
  getLeadRuleText,
  isBiddingRuleOverridden,
  isLeadRuleOverridden,
  listBiddingRuleFiles,
  listLeadRuleFiles,
  loadBiddingRules,
  loadLeadRules,
  resetBiddingRuleText,
  resetLeadRuleText,
  saveBiddingRuleText,
  saveLeadRuleText,
  validateBiddingRuleText,
  validateLeadRuleText,
  type RuleKind,
  type RuleValidationResult,
} from '../engine/loader';
import { canEditRules as canEditRulesFor, type UserRole } from '../permissions';

/** AI 叫牌前的思考延迟（出牌节奏由 PLAY_DISPLAY_MS 控制） */
export const AI_DELAY_MS = 800;

/** 每张出牌至少展示的时长：展示满后才进行下一个动作（含自动出牌） */
export const PLAY_DISPLAY_MS = 1000;

const VULNERABILITIES: GameState['vulnerability'][] = ['none', 'NS', 'EW', 'both'];

/** 单局对局记录（用于“对局历史”复盘：叫牌 + 出牌过程） */
export interface DealRecord {
  /** 第几局（从 1 开始） */
  index: number;
  dealer: Position;
  vulnerability: GameState['vulnerability'];
  biddingHistory: BidRecord[];
  contract: Contract | null;
  /** 已完成的墩 */
  tricks: Trick[];
  /** 进行中的墩（尚未完成 4 张） */
  currentTrick: CardPlay[];
  /** 本副发牌时双方联手大牌点（贴点制计分的依据） */
  hcp: { NS: number; EW: number };
  /** 本副原始四手牌（出牌会消耗 hands，这里保留发牌快照用于复盘） */
  hands?: Record<Position, Hand>;
  score: { NS: number; EW: number };
  phase: GamePhase;
}

function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 一个计点循环的长度（副数） */
export type RoundSize = 8 | 16;

/** 计点（IMP）胜负汇总 */
export interface PointsSummary {
  /** 本局点数（带符号，>0 为 NS 赢，<0 为 EW 赢）；已按当前设置应用“贴点” */
  dealPoints: number;
  /** 本局原始 IMP（带符号，未贴点） */
  dealImp: number;
  /** 本局贴点调整量 = dealPoints − dealImp（带符号；关闭贴点时恒为 0） */
  dealAdjust: number;
  /** 本局双方联手大牌点 */
  dealHcp: { NS: number; EW: number };
  /** 本循环 NS 累计点数 */
  roundNS: number;
  /** 本循环 EW 累计点数 */
  roundEW: number;
  /** 本循环总点数差（NS − EW），即“计点胜负” */
  roundDiff: number;
  /** 第几个循环（1 起） */
  roundNumber: number;
  /** 本循环已完成副数 */
  dealsPlayed: number;
  /** 本循环长度 */
  roundSize: RoundSize;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createInitialState(): GameState {
  return {
    phase: 'idle',
    dealer: 'N',
    vulnerability: 'none',
    hands: { N: [], E: [], S: [], W: [] },
    biddingHistory: [],
    currentBid: null,
    doubleState: 'none',
    currentBidder: 'N',
    contract: null,
    tricks: [],
    currentTrick: [],
    trickLeader: null,
    nextPlayer: null,
    dummyOpen: false,
    score: { NS: 0, EW: 0 },
    message: '点击“新一局”开始',
    isAiThinking: false,
    humanSeats: ['S'],
    styles: {
      N: { bid: 1, play: 1, randomness: 0 },
      E: { bid: 1, play: 1, randomness: 0 },
      S: { bid: 1, play: 1, randomness: 0 },
      W: { bid: 1, play: 1, randomness: 0 },
    },
    rngSeed: Date.now() >>> 0,
  };
}

export const useGameStore = defineStore('game', () => {
  const state = reactive<GameState>(createInitialState());

  // —— 规则资产（可切换文件）——
  const biddingFileNames = listBiddingRuleFiles().map((f) => f.name);
  const leadFileNames = listLeadRuleFiles().map((f) => f.name);
  const defaultBiddingFile = biddingFileNames.includes('precision') ? 'precision' : (biddingFileNames[0] ?? 'precision');
  const defaultLeadFile = leadFileNames.includes('leads') ? 'leads' : (leadFileNames[0] ?? 'leads');
  const biddingRuleFile = reactive({ name: defaultBiddingFile });
  const leadRuleFile = reactive({ name: defaultLeadFile });
  const biddingRules = reactive<{ rules: BiddingRule[] }>({ rules: loadBiddingRules(biddingRuleFile.name) });
  const leadRules = reactive<{ rules: LeadRule[] }>({ rules: loadLeadRules(leadRuleFile.name) });

  // —— 规则编辑权限（当前所有用户可改；后续切换为仅系统管理员）——
  const currentUserRole = ref<UserRole>('user');
  const canEditRules = computed(() => canEditRulesFor(currentUserRole.value));
  /** 规则覆盖版本号：保存/恢复/切换后自增，用于驱动 UI 重新读取 */
  const ruleRevision = ref(0);

  // —— 非响应式内部变量 ——
  let rng: () => number = makeRng(state.rngSeed);
  const gamesPlayed = ref(0);
  let loopToken = 0; // 用于取消进行中的 AI 循环
  /** 最近一次出牌的时间戳，用于保证每张牌至少展示 PLAY_DISPLAY_MS */
  let lastPlayAt = 0;

  /** 自动托管南家（默认关闭）：开启后全部座位由 AI 接管，便于全机器演示与集成测试 */
  const autoPilot = ref(false);

  /** 历史对局记录（已结束/被新一局取代的对局，按时间先后排列） */
  const dealHistory = ref<DealRecord[]>([]);

  /** 计点循环长度（默认 8 副） */
  const roundSize = ref<RoundSize>(8);

  /**
   * 是否启用经典“贴点制”（默认开启）：
   * 本副最终点数 = IMP −（胜方联手大牌点 − 20）。
   */
  const useHcpAdjust = ref(true);

  /** 本副发牌时双方联手大牌点（出牌会消耗手牌，故单独保存供结算与复盘使用） */
  const dealHcp = ref<{ NS: number; EW: number }>({ NS: 20, EW: 20 });

  /** 本副发牌快照（出牌会消耗 state.hands，结算时需要展示四手牌分布） */
  const dealHands = ref<Record<Position, Hand>>({ N: [], E: [], S: [], W: [] });

  /**
   * 计点（IMP）胜负汇总：本局点数 + 本循环累计点数与总点数差。
   * 以 `roundSize` 副为一个完整循环；已结算的对局计入所在循环。
   * 启用贴点时，逐副按「IMP −（胜方大牌点 − 20）」折算，再累加。
   */
  const pointsSummary = computed<PointsSummary>(() => {
    const size = roundSize.value;
    const currentIndex = gamesPlayed.value;
    const roundNumber = currentIndex > 0 ? Math.floor((currentIndex - 1) / size) + 1 : 1;
    const roundStart = (roundNumber - 1) * size + 1;

    /** 一副牌的最终点数（带符号，NS 视角），按当前设置决定是否贴点 */
    const pointsOf = (score: { NS: number; EW: number }, sides: { NS: number; EW: number }): number => {
      const diff = score.NS - score.EW;
      return useHcpAdjust.value ? hcpAdjustedPoints(diff, sides.NS, sides.EW) : impsFromScoreDiff(diff);
    };

    let roundNS = 0;
    let roundEW = 0;
    let dealsPlayed = 0;

    const accumulate = (
      index: number,
      score: { NS: number; EW: number },
      phase: GamePhase,
      sides: { NS: number; EW: number },
    ): void => {
      if (index < roundStart || phase !== 'scoring') return;
      const points = pointsOf(score, sides);
      if (points > 0) roundNS += points;
      else if (points < 0) roundEW += -points;
      dealsPlayed += 1;
    };

    for (const r of dealHistory.value) accumulate(r.index, r.score, r.phase, r.hcp ?? { NS: 20, EW: 20 });
    if (currentIndex > 0) accumulate(currentIndex, state.score, state.phase, dealHcp.value);

    const dealImp = state.phase === 'scoring' ? impsFromScoreDiff(state.score.NS - state.score.EW) : 0;
    const dealPoints = state.phase === 'scoring' ? pointsOf(state.score, dealHcp.value) : 0;

    return {
      dealPoints,
      dealImp,
      dealAdjust: dealPoints - dealImp,
      dealHcp: { ...dealHcp.value },
      roundNS,
      roundEW,
      roundDiff: roundNS - roundEW,
      roundNumber,
      dealsPlayed,
      roundSize: size,
    };
  });

  /** 将当前对局快照存入历史（仅当本局已有动作时） */
  function archiveCurrentDeal(): void {
    const hasActivity =
      state.biddingHistory.length > 0 || state.tricks.length > 0 || state.currentTrick.length > 0 || !!state.contract;
    if (!hasActivity) return;
    dealHistory.value.push({
      index: gamesPlayed.value,
      dealer: state.dealer,
      vulnerability: state.vulnerability,
      biddingHistory: deepCopy(state.biddingHistory),
      contract: deepCopy(state.contract),
      tricks: deepCopy(state.tricks),
      currentTrick: deepCopy(state.currentTrick),
      hcp: { ...dealHcp.value },
      hands: deepCopy(dealHands.value),
      score: { ...state.score },
      phase: state.phase,
    });
  }

  /** 当前对人类开放的座位（冻结接口的便捷封装） */
  function controlledSeats(): Position[] {
    if (!state.contract) return [...state.humanSeats];
    const declSide = getSide(state.contract.declarer);
    const humanOnDeclSide = state.humanSeats.some((p) => getSide(p) === declSide);
    return humanOnDeclSide ? [state.contract.declarer, state.contract.dummy] : [...state.humanSeats];
  }

  function isHumanControlled(pos: Position): boolean {
    if (autoPilot.value) return false;
    return controlledSeats().includes(pos);
  }

  /* ---------------------------------------------------------------- *
   * 底层的“落子”操作
   * ---------------------------------------------------------------- */

  function applyBid(pos: Position, call: BidCall): void {
    state.biddingHistory.push({ position: pos, call });
    if (call.type === 'bid') {
      state.currentBid = { level: call.level, suit: call.suit };
      state.doubleState = 'none';
    } else if (call.type === 'double') {
      state.doubleState = 'double';
    } else if (call.type === 'redouble') {
      state.doubleState = 'redouble';
    }
    state.currentBidder = nextPosition(pos);
    state.message = `${pos} ${describeCall(call)}`;
  }

  /**
   * 判定叫牌是否结束：
   * - 无任何叫品且已累积 4 个 Pass → 流局（passed_out）；
   * - 已有叫品且出现连续 3 个 Pass → 正常结束（contract）；
   * - 否则未结束（none）。
   */
  function checkBiddingEnd(): 'none' | 'contract' | 'passed_out' {
    const h = state.biddingHistory;
    if (state.currentBid === null) {
      if (h.length >= 4 && h.slice(-4).every((r) => r.call.type === 'pass')) {
        state.phase = 'scoring';
        state.score = { NS: 0, EW: 0 };
        state.message = '四家不叫，本局流局';
        return 'passed_out';
      }
      return 'none';
    }
    const last3 = h.slice(-3);
    return last3.length === 3 && last3.every((r) => r.call.type === 'pass') ? 'contract' : 'none';
  }

  /** 找庄家：最终定约花色最早叫出的定约方成员 */
  function findDeclarer(history: BidRecord[]): Position {
    const finalBid = state.currentBid!;
    const lastBidder = [...history]
      .reverse()
      .find((r) => r.call.type === 'bid' && r.call.level === finalBid.level && r.call.suit === finalBid.suit)!;
    const declSide = getSide(lastBidder.position);
    for (const rec of history) {
      if (rec.call.type === 'bid' && rec.call.suit === finalBid.suit && getSide(rec.position) === declSide) {
        return rec.position;
      }
    }
    return lastBidder.position;
  }

  /** 叫牌结束、确立定约并进入首攻等待 */
  function setContractAndStartPlay(): void {
    const declarer = findDeclarer(state.biddingHistory);
    const dummy = getPartner(declarer);
    state.contract = state.currentBid
      ? {
          level: state.currentBid.level,
          suit: state.currentBid.suit,
          doubled: state.doubleState === 'double',
          redoubled: state.doubleState === 'redouble',
          declarer,
          dummy,
        }
      : null;
    state.phase = 'play_waiting_lead';
    state.trickLeader = nextPosition(declarer); // 首攻 = 庄家左手方
    state.nextPlayer = state.trickLeader;
    state.currentTrick = [];
    state.message = `定约 ${describeContract(state.contract)}，等待首攻`;
  }

  function applyPlay(pos: Position, card: number): void {
    state.hands[pos] = state.hands[pos].filter((c) => c !== card);
    state.currentTrick.push({ position: pos, card });
    // 首攻落地后立刻翻开明手（验收用例 13）
    if (!state.dummyOpen && state.contract) {
      state.dummyOpen = true;
    }
    lastPlayAt = Date.now();
    if (state.currentTrick.length === 4) {
      settleTrick();
    } else {
      state.phase = 'play';
      state.nextPlayer = nextPosition(pos);
    }
  }

  function settleTrick(): void {
    const contract = state.contract!;
    const trump = trumpSuitOf(contract);
    const leader = state.trickLeader!;
    const winner = determineTrickWinner(state.currentTrick, trump);
    state.tricks.push({ plays: [...state.currentTrick], leader, winner });
    state.currentTrick = [];
    state.trickLeader = winner;
    state.nextPlayer = winner;
    state.message = `${winner} 赢得第 ${state.tricks.length} 墩`;
    if (state.tricks.length === 13) {
      state.phase = 'scoring';
      computeFinalScore();
    } else {
      state.phase = 'play_waiting_lead';
    }
  }

  /** 统计定约方已赢墩数 */
  function declarerTricksWon(): number {
    if (!state.contract) return 0;
    const declSide = getSide(state.contract.declarer);
    return state.tricks.filter((t) => getSide(t.winner) === declSide).length;
  }

  function computeFinalScore(): void {
    if (!state.contract) {
      state.score = { NS: 0, EW: 0 };
      return;
    }
    const won = declarerTricksWon();
    const result: ScoreResult = computeScore(state.contract, won, state.vulnerability);
    state.score = result;
    state.message = `定约方赢得 ${won} 墩；得分 NS ${result.NS} / EW ${result.EW}`;
  }

  /* ---------------------------------------------------------------- *
   * AI 决策
   * ---------------------------------------------------------------- */

  function decideAiBid(pos: Position): BidCall {
    const cfg = state.styles[pos];
    return bidAI(state.hands[pos], state.biddingHistory, pos, state.currentBid, biddingRules.rules, {
      style: cfg.bid,
      randomness: cfg.randomness,
      rng,
    });
  }

  function decideAiPlay(pos: Position): number {
    const contract = state.contract!;
    const dummyHand = state.dummyOpen ? state.hands[contract.dummy] : null;
    return playAI(
      state.hands[pos],
      dummyHand,
      state.currentTrick,
      trumpSuitOf(contract),
      pos,
      contract,
      declarerTricksWon(),
      leadRules.rules,
      state.styles[pos].play,
      { rng, biddingHistory: state.biddingHistory },
    );
  }

  /** 当前座位所有合法出牌（首攻/领出时整手牌都合法） */
  function legalCardsFor(pos: Position): Hand {
    if (!state.contract) return [];
    const leadSuit = state.currentTrick.length === 0 ? null : getSuit(state.currentTrick[0].card);
    return getLegalCards(state.hands[pos], leadSuit, trumpSuitOf(state.contract));
  }

  /**
   * 等待上一张出牌展示满 PLAY_DISPLAY_MS。
   * 返回 false 表示等待期间已开始新一局/新循环，调用方应立即退出。
   */
  async function holdLastPlay(token: number): Promise<boolean> {
    const remaining = PLAY_DISPLAY_MS - (Date.now() - lastPlayAt);
    if (remaining <= 0) return token === loopToken;
    state.isAiThinking = true;
    await sleep(remaining);
    if (token !== loopToken) return false;
    state.isAiThinking = false;
    return true;
  }

  /**
   * AI 主循环：接管“非人类控制”的座位；轮到人类即返回等待输入。
   * 任何座位（包括人类控制的座位）只剩唯一合法出牌时，直接自动打出。
   */
  async function runAILoop(): Promise<void> {
    const token = ++loopToken;
    // 新循环接管时清理上一循环可能残留的“思考中”状态
    state.isAiThinking = false;
    for (;;) {
      if (token !== loopToken) return; // 已被新一局/新循环取代
      if (state.phase === 'bidding') {
        const pos = state.currentBidder;
        if (isHumanControlled(pos)) return;
        state.isAiThinking = true;
        await sleep(AI_DELAY_MS);
        if (token !== loopToken) return;
        const call = decideAiBid(pos);
        applyBid(pos, call);
        state.isAiThinking = false;
        const bidEnd = checkBiddingEnd();
        if (bidEnd === 'passed_out') return; // 流局
        if (bidEnd === 'contract') setContractAndStartPlay();
        continue;
      }
      if (state.phase === 'play_waiting_lead' || state.phase === 'play') {
        const pos = state.nextPlayer;
        if (pos === null) return;
        const legal = legalCardsFor(pos);
        if (legal.length === 0) return;
        const forced = legal.length === 1 ? legal[0] : null;
        const humanChooses = isHumanControlled(pos) && forced === null;

        // 先让上一张牌展示满 1 秒，再进行下一个动作（包括人类回合）
        if (!(await holdLastPlay(token))) return;
        if (humanChooses) return;

        // AI 决策本身是同步的；展示等待已兼顾“思考”时长，避免额外拖延下一张牌
        const card = forced !== null ? forced : decideAiPlay(pos);
        applyPlay(pos, card);
        state.isAiThinking = false;
        continue;
      }
      return; // idle / scoring：结束
    }
  }

  /* ---------------------------------------------------------------- *
   * 开局与对外动作
   * ---------------------------------------------------------------- */

  interface StartOptions {
    seed?: number;
    dealer?: Position;
    /** 是否自动启动 AI 循环（测试可置 false 以手动驱动） */
    autoStart?: boolean;
  }

  function startNewGame(opts: StartOptions = {}): void {
    loopToken++; // 取消进行中的 AI 循环
    archiveCurrentDeal(); // 归档上一局
    gamesPlayed.value += 1;
    const seed = opts.seed ?? ((Date.now() >>> 0) ^ (Math.floor(Math.random() * 0xffffffff) >>> 0)) >>> 0;
    state.rngSeed = seed >>> 0;
    rng = makeRng(state.rngSeed);

    // 发牌
    const deck = shuffle(createDeck(), rng);
    const dealt = deal(deck);
    (['N', 'E', 'S', 'W'] as Position[]).forEach((p) => {
      state.hands[p] = sortHand(dealt[p]);
    });
    dealHands.value = deepCopy(state.hands);

    // 记录本副双方联手大牌点（贴点制计分依据）
    dealHcp.value = {
      NS: hcp(state.hands.N) + hcp(state.hands.S),
      EW: hcp(state.hands.E) + hcp(state.hands.W),
    };

    // 局况：等概率随机（验收要求）
    state.vulnerability = VULNERABILITIES[Math.floor(rng() * VULNERABILITIES.length)];

    // 庄家轮转：首局 N，其后顺时针推进
    state.dealer = opts.dealer ?? (gamesPlayed.value === 1 ? 'N' : nextPosition(state.dealer));

    // 重置对局状态
    state.phase = 'bidding';
    state.biddingHistory = [];
    state.currentBid = null;
    state.doubleState = 'none';
    state.currentBidder = state.dealer;
    state.contract = null;
    state.tricks = [];
    state.currentTrick = [];
    state.trickLeader = null;
    state.nextPlayer = null;
    state.dummyOpen = false;
    lastPlayAt = 0;
    state.score = { NS: 0, EW: 0 };
    state.isAiThinking = false;
    state.message = `第 ${gamesPlayed.value} 局开始，庄家 ${state.dealer}，局况 ${vulName(state.vulnerability)}`;

    if (opts.autoStart !== false) void runAILoop();
  }

  /** 人类叫牌（仅受核心法律约束，可诈叫） */
  async function humanBid(call: BidCall): Promise<void> {
    if (state.phase !== 'bidding') return;
    const pos = state.currentBidder;
    if (!isHumanControlled(pos)) return;
    if (!isCallLegal(state.biddingHistory, state.currentBid, pos, call)) {
      state.message = '该叫品不合法';
      return;
    }
    applyBid(pos, call);
    const bidEnd = checkBiddingEnd();
    if (bidEnd === 'passed_out') return; // 流局
    if (bidEnd === 'contract') setContractAndStartPlay();
    await runAILoop();
  }

  /** 人类出牌（人类为定约方时可同时操作庄家与明手） */
  async function humanPlay(card: number): Promise<void> {
    if (state.phase !== 'play' && state.phase !== 'play_waiting_lead') return;
    const pos = state.nextPlayer;
    if (pos === null || !isHumanControlled(pos)) return;
    const leadSuit = state.currentTrick.length === 0 ? null : getSuit(state.currentTrick[0].card);
    if (!isCardLegal(card, state.hands[pos], leadSuit)) {
      state.message = '该牌不合法（必须跟出领出花色）';
      return;
    }
    applyPlay(pos, card);
    await runAILoop();
  }

  /* ---------------------------------------------------------------- *
   * 配置
   * ---------------------------------------------------------------- */

  function setSeatStyle(pos: Position, patch: Partial<SeatStyle>): void {
    state.styles[pos] = { ...state.styles[pos], ...patch };
  }

  function setSeatBidStyle(pos: Position, bid: StyleLevel): void {
    setSeatStyle(pos, { bid });
  }

  function setBiddingRuleFile(name: string): void {
    biddingRuleFile.name = name;
    biddingRules.rules = loadBiddingRules(name);
  }

  function setLeadRuleFile(name: string): void {
    leadRuleFile.name = name;
    leadRules.rules = loadLeadRules(name);
  }

  /* ---------------------------------------------------------------- *
   * 规则浏览 / 修改（叫牌 + 打牌首攻）
   * ---------------------------------------------------------------- */

  /** 读取规则源码：优先本地覆盖版本，否则内置默认 */
  function getRuleSource(kind: RuleKind, name: string): string {
    void ruleRevision.value;
    return kind === 'bidding' ? getBiddingRuleText(name) : getLeadRuleText(name);
  }

  /** 该规则文件是否存在本地修改 */
  function isRuleOverridden(kind: RuleKind, name: string): boolean {
    void ruleRevision.value;
    return kind === 'bidding' ? isBiddingRuleOverridden(name) : isLeadRuleOverridden(name);
  }

  /** 校验规则源码（YAML 语法 + 必备字段），不写入 */
  function validateRuleSource(kind: RuleKind, text: string): RuleValidationResult {
    return kind === 'bidding' ? validateBiddingRuleText(text) : validateLeadRuleText(text);
  }

  /** 保存并应用规则源码；校验失败会抛错，不写入 */
  function saveRuleSource(kind: RuleKind, name: string, text: string): void {
    if (!canEditRules.value) throw new Error('当前账号无规则修改权限（仅系统管理员可修改）');
    if (kind === 'bidding') {
      saveBiddingRuleText(name, text);
      if (biddingRuleFile.name === name) biddingRules.rules = loadBiddingRules(name);
    } else {
      saveLeadRuleText(name, text);
      if (leadRuleFile.name === name) leadRules.rules = loadLeadRules(name);
    }
    ruleRevision.value += 1;
  }

  /** 清除某个规则文件的本地修改，恢复内置默认 */
  function resetRuleSource(kind: RuleKind, name: string): void {
    if (!canEditRules.value) throw new Error('当前账号无规则修改权限（仅系统管理员可修改）');
    if (kind === 'bidding') {
      resetBiddingRuleText(name);
      if (biddingRuleFile.name === name) biddingRules.rules = loadBiddingRules(name);
    } else {
      resetLeadRuleText(name);
      if (leadRuleFile.name === name) leadRules.rules = loadLeadRules(name);
    }
    ruleRevision.value += 1;
  }

  /** 清除所有规则文件的本地修改 */
  function resetAllRuleOverrides(): void {
    if (!canEditRules.value) throw new Error('当前账号无规则修改权限（仅系统管理员可修改）');
    clearRuleOverrides();
    biddingRules.rules = loadBiddingRules(biddingRuleFile.name);
    leadRules.rules = loadLeadRules(leadRuleFile.name);
    ruleRevision.value += 1;
  }

  /** 设置当前用户角色（接入后台登录态后由系统注入） */
  function setCurrentUserRole(role: UserRole): void {
    currentUserRole.value = role;
  }

  /** 设置计点循环长度（8 或 16 副） */
  function setRoundSize(size: RoundSize): void {
    roundSize.value = size === 16 ? 16 : 8;
  }

  /** 开启/关闭经典“贴点制”（关闭后本副点数即原始 IMP） */
  function setUseHcpAdjust(value: boolean): void {
    useHcpAdjust.value = value;
  }

  /** 开启/关闭自动托管；开启时若正轮到人类，立即交给 AI 循环 */
  function setAutoPilot(value: boolean): void {
    autoPilot.value = value;
    if (value && (state.phase === 'bidding' || state.phase === 'play' || state.phase === 'play_waiting_lead')) {
      void runAILoop();
    }
  }

  return {
    ...toRefs(state),
    autoPilot,
    dealHistory,
    gamesPlayed,
    roundSize,
    pointsSummary,
    useHcpAdjust,
    dealHcp,
    dealHands,
    // 规则资产
    biddingRules,
    leadRules,
    biddingRuleFile,
    leadRuleFile,
    availableBiddingFiles: biddingFileNames,
    availableLeadFiles: leadFileNames,
    // 规则编辑权限
    currentUserRole,
    canEditRules,
    ruleRevision,
    // 派生
    controlledSeats,
    isHumanControlled,
    declarerTricksWon,
    // 动作
    startNewGame,
    humanBid,
    humanPlay,
    archiveCurrentDeal,
    applyBid,
    applyPlay,
    checkBiddingEnd,
    setContractAndStartPlay,
    runAILoop,
    settleTrick,
    computeFinalScore,
    setSeatStyle,
    setSeatBidStyle,
    setBiddingRuleFile,
    setLeadRuleFile,
    // 规则浏览 / 修改
    getRuleSource,
    isRuleOverridden,
    validateRuleSource,
    saveRuleSource,
    resetRuleSource,
    resetAllRuleOverrides,
    setCurrentUserRole,
    setAutoPilot,
    setRoundSize,
    setUseHcpAdjust,
  };
});

/* ------------------------------------------------------------------ *
 * 文案辅助
 * ------------------------------------------------------------------ */

/** 叫牌过程里的 Pass 统一用单横杠表示 */
export const PASS_TEXT = '—';
/** 叫牌结束的最后一个 Pass 用等号（上下双横杠）表示 */
export const FINAL_PASS_TEXT = '=';

export function describeCall(call: BidCall): string {
  switch (call.type) {
    case 'pass':
      return PASS_TEXT;
    case 'bid':
      return `${call.level}${suitName(call.suit)}`;
    case 'double':
      return '加倍';
    case 'redouble':
      return '再加倍';
  }
}

export function suitName(suit: BidSuit): string {
  const map: Record<BidSuit, string> = { C: '♣', D: '♦', H: '♥', S: '♠', NT: 'NT' };
  return map[suit];
}

export function describeContract(contract: GameState['contract']): string {
  if (!contract) return '未定约';
  const doubled = contract.doubled ? '×2' : contract.redoubled ? '×4' : '';
  return `${contract.declarer} ${contract.level}${suitName(contract.suit)}${doubled}`;
}

export function vulName(v: GameState['vulnerability']): string {
  return { none: 'None', NS: 'NS', EW: 'EW', both: 'Both' }[v];
}

export type { Hand };
