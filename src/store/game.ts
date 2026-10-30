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
import { getSide, nextPosition, trumpSuitOf } from '../models/gameState';
import type { Hand } from '../models/hand';
import { createDeck, deal, shuffle } from '../core/deck';
import { auctionOutcome, contractFromAuction } from '../core/auction';
import { parsePbnDeal, toPbnDeal } from '../core/pbn';
import { sortHand } from '../models/hand';
import { getSuit } from '../models/card';
import { isCallLegal, lastBidOf } from '../core/bidding/validator';
import { getLegalCards, isCardLegal } from '../core/playing';
import { determineTrickWinner } from '../core/trick';
import { computeScore, type ScoreResult } from '../core/scoring';
import { hcpAdjustedPoints, impsFromScoreDiff } from '../core/imps';
import { hcp } from '../core/evaluate';
import { bidAIResult } from '../ai/bidAI';
import { describePlayDecision, playAI } from '../ai/playAI';
import { isDdsAvailable } from '../ai/dds/client';
import { chooseDdsPlay } from '../ai/dds/play';
import type { BiddingRule, LeadRule, SignalRuleSet } from '../engine/types';
import { makeRng } from '../engine/arbiter';
import { findCandidateForCall } from '../engine/bidMeaning';
import {
  clearRuleOverrides,
  getBiddingRuleText,
  getLeadRuleText,
  getSignalRuleText,
  isBiddingRuleOverridden,
  isLeadRuleOverridden,
  isSignalRuleOverridden,
  listBiddingRuleFiles,
  listLeadRuleFiles,
  listSignalRuleFiles,
  loadBiddingRuleSet,
  loadLeadRules,
  loadSignalRules,
  resetBiddingRuleText,
  resetLeadRuleText,
  resetSignalRuleText,
  saveBiddingRuleText,
  saveLeadRuleText,
  saveSignalRuleText,
  validateBiddingRuleText,
  validateLeadRuleText,
  validateSignalRuleText,
  type BiddingRuleSet,
  type RuleKind,
  type RuleValidationResult,
} from '../engine/loader';
import { canEditRules as canEditRulesFor, type UserRole } from '../permissions';
import {
  HINTS_TRIAL_DEALS,
  HINTS_TRIAL_ENDED_STORAGE_KEY,
  HINTS_TRIAL_STORAGE_KEY,
  canEnableHints as canEnableHintsFor,
  hintsTrialRemaining as hintsTrialRemainingFor,
} from '../membership';
import { jcs } from '../brules/jcs';
import { sha256Hex } from '../brules/sha256';
import { EventLog } from '../domain/events/log';
import type {
  BridgeEventPayloads,
  BridgeEventType,
  EventActor,
} from '../domain/events/types';
import {
  ENGINE_VERSION,
  buildTableBoardRecord,
  callFromCode,
  contractFromRecord,
  createDealId,
  createRecordId,
  deriveImportedSeeds,
  deriveStreamSeeds,
  parseTableBoardRecordDetailed,
  randomSeed,
  tableBoardFromPbn,
  tableBoardToPbn,
  toTableBoardCsv,
  toInternalVulnerability,
  toRecordVulnerability,
  toPbnRecordText,
  tokenToCard,
  toTableBoardJson,
  type DealSource,
  type EngineSnapshot,
  type EngineStreamSeeds,
  type ExchangeIssue,
  type LossReport,
  type RecordAdjustment,
  type RecordStatus,
  type RecordVulnerability,
  type SeatEngine,
  type TableBoardRecord,
} from '../exchange';

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
  /** 开局冻结的引擎快照；旧归档记录可能没有。 */
  engine?: EngineSnapshot;
  recordId?: string;
  createdAt?: string;
  dealId?: string;
  boardNumber?: number;
  scoreSource?: 'computed' | 'director';
}

/** 当前人类正在选择/被推荐的叫品含义（供牌桌浮窗实时预览） */
export interface BidPreview {
  position: Position;
  call: BidCall;
  meaning: string;
  /** 是否为规则引擎推荐叫品 */
  recommended: boolean;
  /** 当前悬停叫品不是推荐叫品时，同时展示推荐叫品及其含义 */
  recommendedCall?: BidCall;
  recommendedMeaning?: string;
}

/** 人类出牌推荐：牌张 + 简短理由（供推荐箭头浮层展示） */
export interface PlayRecommendation {
  card: number;
  reason: string;
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
  const signalFileNames = listSignalRuleFiles().map((f) => f.name);
  const defaultBiddingFile = biddingFileNames.includes('precision') ? 'precision' : (biddingFileNames[0] ?? 'precision');
  const defaultLeadFile = leadFileNames.includes('leads') ? 'leads' : (leadFileNames[0] ?? 'leads');
  const defaultSignalFile = signalFileNames.includes('signals') ? 'signals' : (signalFileNames[0] ?? 'signals');
  const biddingRuleFile = reactive({ name: defaultBiddingFile });
  const leadRuleFile = reactive({ name: defaultLeadFile });
  const signalRuleFile = reactive({ name: defaultSignalFile });
  /**
   * 当前生效的叫牌规则集（内置 + 本地覆盖合并后的编译结果）。
   * `rules` 保持 IR 声明顺序；额外字段供诊断与复现快照使用。
   */
  const biddingRules = reactive<BiddingRuleSet>({
    source: '',
    format: 'unsupported',
    system: 'unknown',
    rules: [],
    diagnostics: [],
    rulesetId: null,
    ir: null,
  });

  function reloadBiddingRuleSet(name: string): void {
    const loaded = loadBiddingRuleSet(name);
    biddingRules.source = loaded.source;
    biddingRules.format = loaded.format;
    biddingRules.system = loaded.system;
    biddingRules.systemVersion = loaded.systemVersion;
    biddingRules.rules = loaded.rules;
    biddingRules.diagnostics = loaded.diagnostics;
    biddingRules.rulesetId = loaded.rulesetId;
    biddingRules.ir = loaded.ir;
  }
  reloadBiddingRuleSet(biddingRuleFile.name);

  /**
   * 开局时冻结的叫牌规则快照。
   * 局中修改/切换规则只影响后续牌局，不改变当前副的裁决与 rulesetId。
   */
  const dealBiddingRules = ref<readonly BiddingRule[]>([]);
  const dealRulesetId = ref<string | null>(null);
  const activeBiddingRules = computed<BiddingRule[]>(() =>
    dealBiddingRules.value.length > 0 ? [...dealBiddingRules.value] : biddingRules.rules,
  );
  const activeRulesetId = computed(() => dealRulesetId.value ?? biddingRules.rulesetId);

  function freezeBiddingRulesForDeal(): void {
    dealBiddingRules.value = Object.freeze([...biddingRules.rules]);
    dealRulesetId.value = biddingRules.rulesetId;
  }

  /* ---------------------------------------------------------------- *
   * 当前副的复现快照（beginAuction 时冻结）
   * ---------------------------------------------------------------- */

  const dealEngine = ref<EngineSnapshot | null>(null);
  const dealPbnText = ref('');
  const dealRecordId = ref('');
  const dealCreatedAt = ref('');
  const dealDealId = ref('');
  const dealBoardNumber = ref(0);
  const dealScoreSource = ref<'computed' | 'director'>('computed');
  /** 导入记录时保留的异常状态与审计；正常对局为 null，由牌局推导。 */
  const dealStatus = ref<RecordStatus | null>(null);
  const dealAdjustment = ref<RecordAdjustment | undefined>(undefined);
  const dealAdjustHistory = ref<RecordAdjustment[] | undefined>(undefined);
  const dealUpdatedAt = ref<string | undefined>(undefined);

  function clearImportedRecordState(): void {
    dealStatus.value = null;
    dealAdjustment.value = undefined;
    dealAdjustHistory.value = undefined;
    dealUpdatedAt.value = undefined;
  }

  /** 只保留能通过 1.1 校验的导入状态；1.0 缺审计的取消/调整记录退回牌局推导。 */
  function preservedRecordStatus(record: TableBoardRecord): RecordStatus | undefined {
    if (record.status === 'CANCELLED') {
      return record.adjustment?.kind === 'CANCEL' ? record.status : undefined;
    }
    if (record.status === 'REOPENED') {
      return record.adjustment?.kind === 'REOPEN' ? record.status : undefined;
    }
    if (record.status === 'ADJUSTED') {
      return record.adjustment?.kind === 'ADJUST' && record.adjustHistory?.length
        ? record.status
        : undefined;
    }
    return record.status;
  }

  const leadRules = reactive<{ rules: LeadRule[] }>({ rules: loadLeadRules(leadRuleFile.name) });
  const signalRuleSet = reactive<SignalRuleSet>(loadSignalRules(signalRuleFile.name));

  // —— 规则编辑权限（当前所有用户可改；后续切换为仅系统管理员）——
  const currentUserRole = ref<UserRole>('user');
  const canEditRules = computed(() => canEditRulesFor(currentUserRole.value));

  // —— 会员状态（当前无账号体系，默认非会员；后续由登录态注入）——
  const isMember = ref(false);
  /** 规则覆盖版本号：保存/恢复/切换后自增，用于驱动 UI 重新读取 */
  const ruleRevision = ref(0);

  // —— 非响应式内部变量 ——
  // 四条独立随机流（reproducibility.md §3）；不得再用一个共享 rng。
  let dealRng: () => number = makeRng(state.rngSeed);
  let biddingRng: () => number = makeRng(state.rngSeed);
  let playRng: () => number = makeRng(state.rngSeed);
  let ddsRng: () => number = makeRng(state.rngSeed);
  const gamesPlayed = ref(0);
  /** 单机阶段的本地事件流；服务端接入后由 session/table id 替换。 */
  const LOCAL_SESSION_ID = 'session-local';
  const LOCAL_TABLE_ID = 'table-1';
  let currentEventLog: EventLog | null = null;
  let boardCompletedEventEmitted = false;

  function appendEvent<T extends BridgeEventType>(
    type: T,
    payload: BridgeEventPayloads[T],
    actor: EventActor,
  ): void {
    currentEventLog?.append(type, payload, { actor });
  }

  function emitBoardCompleted(status: 'PLAYED' | 'PASSED_OUT', nsRaw: number, tricksTaken: number): void {
    if (!currentEventLog || boardCompletedEventEmitted) return;
    boardCompletedEventEmitted = true;
    currentEventLog.append(
      'board.completed',
      { status, nsRaw, tricksTaken },
      { actor: { kind: 'system' } },
    );
    currentEventLog.append(
      'score.computed',
      {
        nsRaw,
        singleTableImp: impsFromScoreDiff(nsRaw),
        tableVersion: 'wbf-2017',
      },
      { actor: { kind: 'system' } },
    );
  }
  let loopToken = 0; // 用于取消进行中的 AI 循环
  /** 最近一次出牌的时间戳，用于保证每张牌至少展示 PLAY_DISPLAY_MS */
  let lastPlayAt = 0;
  /** 最近一墩结算的时间戳，用于保证完整四张牌至少展示 PLAY_DISPLAY_MS */
  let lastTrickCompletedAt = 0;

  /** 自动托管南家（默认关闭）：开启后全部座位由 AI 接管，便于全机器演示与集成测试 */
  const autoPilot = ref(false);

  /**
   * “推荐 + 浮动层解释”开关（推荐叫品 / 叫牌含义 / 推荐出牌）。
   * 默认开启；会员可自由开关。非会员可试用前 HINTS_TRIAL_DEALS 副，
   * 用完后自动关闭且不能再次开启。开关状态和试用进度都保存在 localStorage。
   */
  const SHOW_HINTS_KEY = 'bridge.showHints.v1';
  function readShowHints(): boolean {
    try {
      const raw = globalThis.localStorage?.getItem(SHOW_HINTS_KEY);
      return raw === null || raw === undefined ? true : raw !== '0';
    } catch {
      return true;
    }
  }
  function readHintsTrialDeals(): number {
    try {
      const raw = globalThis.localStorage?.getItem(HINTS_TRIAL_STORAGE_KEY);
      const value = Number.parseInt(raw ?? '0', 10);
      if (!Number.isFinite(value)) return 0;
      return Math.min(HINTS_TRIAL_DEALS, Math.max(0, value));
    } catch {
      return 0;
    }
  }
  function readHintsTrialEnded(): boolean {
    try {
      return globalThis.localStorage?.getItem(HINTS_TRIAL_ENDED_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }
  const hintsTrialDealsUsed = ref(readHintsTrialDeals());
  const hintsTrialEnded = ref(readHintsTrialEnded());
  const showHints = ref(
    readShowHints() &&
      (isMember.value ||
        (!hintsTrialEnded.value && hintsTrialDealsUsed.value <= HINTS_TRIAL_DEALS)),
  );
  const hintsTrialRemaining = computed(() =>
    hintsTrialRemainingFor(isMember.value, hintsTrialDealsUsed.value),
  );
  const hintsTrialExhausted = computed(() => !isMember.value && hintsTrialEnded.value);
  const canEnableHints = computed(
    () =>
      isMember.value ||
      (!hintsTrialEnded.value && canEnableHintsFor(false, hintsTrialDealsUsed.value)),
  );

  function persistHintsTrialDeals(): void {
    try {
      globalThis.localStorage?.setItem(HINTS_TRIAL_STORAGE_KEY, String(hintsTrialDealsUsed.value));
    } catch {
      // 无 localStorage 环境（测试/隐私模式）下仅保留内存状态
    }
  }

  function persistHintsTrialEnded(): void {
    try {
      globalThis.localStorage?.setItem(HINTS_TRIAL_ENDED_STORAGE_KEY, hintsTrialEnded.value ? '1' : '0');
    } catch {
      // 无 localStorage 环境（测试/隐私模式）下仅保留内存状态
    }
  }

  /** 人类当前选择/推荐叫品的实时含义（供牌桌浮窗预览，叫牌结束或关闭提示时清空） */
  const bidPreview = ref<BidPreview | null>(null);

  /** 深度打牌：用 DDS + 隐藏牌抽样做蒙特卡洛决策（浏览器环境默认开启） */
  const useDdsPlayAI = ref(true);

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

  /** 对 JSON 数据做 JCS 语义哈希；用于首攻/信号规则集身份。 */
  function semanticHash(value: unknown): string {
    const clean = JSON.parse(JSON.stringify(value)) as unknown;
    return `sha256:${sha256Hex(jcs(clean))}`;
  }

  /** 开局时冻结引擎配置（规则、座位、推断开关、随机流）。 */
  function buildEngineSnapshot(input: {
    dealSource: DealSource;
    streams: EngineStreamSeeds;
  }): EngineSnapshot {
    const rulesetId = biddingRules.rulesetId ?? semanticHash(biddingRules.rules);
    const system =
      biddingRules.system && biddingRules.system !== 'unknown'
        ? biddingRules.system
        : biddingRuleFile.name;
    const systemVersion = biddingRules.systemVersion || '0.5.0';
    const seats = {} as Record<Position, SeatEngine>;
    for (const seat of ['N', 'E', 'S', 'W'] as Position[]) {
      const style = state.styles[seat];
      seats[seat] = {
        controller: autoPilot.value
          ? 'auto-ai'
          : state.humanSeats.includes(seat)
            ? 'human'
            : 'ai',
        bidStyle: style.bid,
        playStyle: style.play,
        randomness: style.randomness,
        ddsPlay: useDdsPlayAI.value,
        ddsSamples: 12,
        objective: 'contract',
      };
    }
    const snapshotAt = new Date().toISOString();
    return {
      dealSource: input.dealSource,
      ...(input.dealSource.kind === 'seeded' && input.streams.deal !== undefined
        ? { rngSeed: input.streams.deal }
        : {}),
      streams: { ...input.streams },
      ruleset: {
        system,
        systemVersion,
        rulesetId,
        overlay: isBiddingRuleOverridden(biddingRuleFile.name),
      },
      playRulesets: {
        lead: {
          name: leadRuleFile.name,
          rulesetId: semanticHash(leadRules.rules),
          overlay: isLeadRuleOverridden(leadRuleFile.name),
        },
        signal: {
          name: signalRuleFile.name,
          rulesetId: semanticHash({
            rules: signalRuleSet.rules,
            settings: signalRuleSet.settings,
          }),
          overlay: isSignalRuleOverridden(signalRuleFile.name),
          settings: { ...signalRuleSet.settings },
        },
      },
      seats,
      inference: { auctionConstraints: true, leadInference: true },
      engineVersion: ENGINE_VERSION,
      snapshotAt,
      rngMode: 'streams',
    };
  }

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
      ...(dealEngine.value ? { engine: deepCopy(dealEngine.value) } : {}),
      ...(dealRecordId.value ? { recordId: dealRecordId.value } : {}),
      ...(dealCreatedAt.value ? { createdAt: dealCreatedAt.value } : {}),
      ...(dealDealId.value ? { dealId: dealDealId.value } : {}),
      ...(dealBoardNumber.value ? { boardNumber: dealBoardNumber.value } : {}),
      scoreSource: dealScoreSource.value,
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

  function applyBid(
    pos: Position,
    call: BidCall,
    meta?: { alerted?: boolean; alertText?: string; ruleId?: string },
  ): void {
    clearImportedRecordState();
    state.biddingHistory.push({
      position: pos,
      call,
      ...(meta?.alerted ? { alerted: true, alertText: meta.alertText } : {}),
      ...(meta?.ruleId ? { ruleId: meta.ruleId } : {}),
    });
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
    appendEvent(
      'auction.call',
      {
        position: pos,
        call,
        ...(meta?.ruleId ? { ruleId: meta.ruleId } : {}),
        ...(meta?.alerted ? { alerted: true, alertText: meta.alertText } : {}),
      },
      { kind: 'player', seat: pos },
    );
  }

  /** 判定叫牌是否结束（规则见 core/auction.ts） */
  function checkBiddingEnd(): 'none' | 'contract' | 'passed_out' {
    const outcome = auctionOutcome(state.biddingHistory, state.currentBid);
    if (outcome === 'passed_out') {
      state.phase = 'scoring';
      state.score = { NS: 0, EW: 0 };
      state.message = '四家不叫，本局流局';
      emitBoardCompleted('PASSED_OUT', 0, 0);
    }
    return outcome;
  }

  /** 叫牌结束、确立定约并进入首攻等待 */
  function setContractAndStartPlay(): void {
    clearImportedRecordState();
    bidPreview.value = null;
    const contract = contractFromAuction(
      state.biddingHistory,
      state.currentBid,
      state.doubleState,
    );
    if (!contract) return;
    state.contract = contract;
    state.phase = 'play_waiting_lead';
    state.trickLeader = nextPosition(contract.declarer); // 首攻 = 庄家左手方
    state.nextPlayer = state.trickLeader;
    state.currentTrick = [];
    state.message = `定约 ${describeContract(contract)}，等待首攻`;
    appendEvent(
      'contract.set',
      { contract, declarer: contract.declarer, tricksTaken: 0 },
      { kind: 'system' },
    );
  }

  function applyPlay(pos: Position, card: number): void {
    clearImportedRecordState();
    state.hands[pos] = state.hands[pos].filter((c) => c !== card);
    state.currentTrick.push({ position: pos, card });
    appendEvent('play.card', { position: pos, card }, { kind: 'player', seat: pos });
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
    const plays = [...state.currentTrick];
    state.tricks.push({ plays, leader, winner });
    appendEvent(
      'trick.completed',
      { index: state.tricks.length, leader, winner, cards: plays },
      { kind: 'system' },
    );
    lastTrickCompletedAt = Date.now();
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
    emitBoardCompleted('PLAYED', result.NS - result.EW, won);
  }

  /* ---------------------------------------------------------------- *
   * AI 决策
   * ---------------------------------------------------------------- */

  function decideAiBid(pos: Position): { call: BidCall; ruleId?: string } {
    const cfg = state.styles[pos];
    const result = bidAIResult(
      state.hands[pos],
      state.biddingHistory,
      pos,
      state.currentBid,
      activeBiddingRules.value,
      {
        style: cfg.bid,
        randomness: cfg.randomness,
        rng: biddingRng,
      },
    );
    return { call: result.call, ruleId: result.candidate?.rule.id };
  }

  async function decideAiPlay(pos: Position): Promise<number> {
    const contract = state.contract!;
    const dummyHand = state.dummyOpen ? state.hands[contract.dummy] : null;
    const fallback = playAI(
      state.hands[pos],
      dummyHand,
      state.currentTrick,
      trumpSuitOf(contract),
      pos,
      contract,
      declarerTricksWon(),
      leadRules.rules,
      state.styles[pos].play,
      { rng: playRng, biddingHistory: state.biddingHistory, signalSettings: signalRuleSet.settings },
    );

    if (!useDdsPlayAI.value || !isDdsAvailable()) return fallback;
    try {
      const decision = await chooseDdsPlay({
        hand: state.hands[pos],
        dummyHand,
        currentTrick: state.currentTrick,
        tricks: state.tricks,
        position: pos,
        contract,
        // 残局候选分布更少、单次求解更快，增加样本数以降低抽样方差。
        samples: state.tricks.length >= 9 ? 24 : state.tricks.length >= 6 ? 16 : 12,
        biddingHistory: state.biddingHistory,
        biddingRules: activeBiddingRules.value,
        styles: {
          N: state.styles.N.bid,
          E: state.styles.E.bid,
          S: state.styles.S.bid,
          W: state.styles.W.bid,
        },
        trustedBiddingSeats: (['N', 'E', 'S', 'W'] as Position[]).filter(
          (seat) => !state.humanSeats.includes(seat),
        ),
        rng: ddsRng,
        preferred: fallback,
        legalCards: legalCardsFor(pos),
      });
      return decision?.card ?? fallback;
    } catch {
      // DDS/Worker 异常时静默回退到启发式，不阻塞对局。
      return fallback;
    }
  }

  /**
   * 当前座位所有合法出牌（首攻/领出时整手牌都合法）。
   * 跟牌时 getLegalCards 只返回领出花色；若该花色只有一张，
   * 返回长度即为 1，会在 runAILoop 中被当作唯一合法牌自动打出。
   */
  function legalCardsFor(pos: Position): Hand {
    if (!state.contract) return [];
    const leadSuit = state.currentTrick.length === 0 ? null : getSuit(state.currentTrick[0].card);
    return getLegalCards(state.hands[pos], leadSuit, trumpSuitOf(state.contract));
  }

  /**
   * 人类出牌推荐（同步启发式，保证点击前即时显示）。
   * 仅使用已固化的首攻规则 + 跟牌/垫牌启发式，不调用耗时的 DDS。
   */
  function recommendPlayDetails(pos: Position): PlayRecommendation | null {
    if (!showHints.value || !state.contract) return null;
    if (!isHumanControlled(pos)) return null;
    const legal = legalCardsFor(pos);
    if (legal.length <= 1) return null;
    const contract = state.contract;
    const dummyHand = state.dummyOpen ? state.hands[contract.dummy] : null;
    const trumpSuit = trumpSuitOf(contract);
    const options = {
      rng: () => 0.5,
      biddingHistory: state.biddingHistory,
      signalSettings: signalRuleSet.settings,
    };
    const card = playAI(
      state.hands[pos],
      dummyHand,
      state.currentTrick,
      trumpSuit,
      pos,
      contract,
      declarerTricksWon(),
      leadRules.rules,
      state.styles[pos].play,
      options,
    );
    const selected = legal.includes(card) ? card : legal[0];
    const reason = describePlayDecision(
      state.hands[pos],
      dummyHand,
      state.currentTrick,
      trumpSuit,
      pos,
      contract,
      declarerTricksWon(),
      leadRules.rules,
      state.styles[pos].play,
      selected,
      options,
    );
    return { card: selected, reason };
  }

  function recommendPlay(pos: Position): number | null {
    return recommendPlayDetails(pos)?.card ?? null;
  }

  /**
   * 等待上一张出牌展示满 PLAY_DISPLAY_MS。
   * 返回 false 表示等待期间已开始新一局/新循环，调用方应立即退出。
   */
  async function holdLastPlay(token: number): Promise<boolean> {
    const sinceCard = PLAY_DISPLAY_MS - (Date.now() - lastPlayAt);
    // 刚结算的一墩也要停满 1 秒，避免下一墩首牌过早覆盖中央四张牌。
    const sinceTrick =
      lastTrickCompletedAt > 0 ? PLAY_DISPLAY_MS - (Date.now() - lastTrickCompletedAt) : 0;
    const remaining = Math.max(sinceCard, sinceTrick);
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
        const decision = decideAiBid(pos);
        applyBid(
          pos,
          decision.call,
          decision.ruleId ? { ruleId: decision.ruleId } : undefined,
        );
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
        // 唯一合法牌没有选择余地：无论人类控制还是 AI，都自动打出。
        // 只有人类控制的座位在有多张合法牌时才停下来等待输入。
        const needsHumanChoice = forced === null && isHumanControlled(pos);

        // 先让上一张牌展示满 1 秒，再进行下一个动作（包括自动出牌）
        if (!(await holdLastPlay(token))) return;
        if (needsHumanChoice) return;

        let card = forced;
        if (card === null) {
          state.isAiThinking = true;
          card = await decideAiPlay(pos);
          if (token !== loopToken) return; // 等待 DDS 期间已开始新一局
        }
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
    /** 副序号（默认 0；与 seed 一起参与四条随机流派生） */
    index?: number;
    dealer?: Position;
    /** 是否自动启动 AI 循环（测试可置 false 以手动驱动） */
    autoStart?: boolean;
  }

  interface BeginAuctionOptions {
    engine: EngineSnapshot;
    pbn: string;
    recordId: string;
    createdAt: string;
    dealId: string;
    boardNumber: number;
    scoreSource?: 'computed' | 'director';
    status?: RecordStatus;
    adjustment?: RecordAdjustment;
    adjustHistory?: RecordAdjustment[];
    updatedAt?: string;
  }

  /** 把一手完整的 52 张牌装载为待叫牌的新对局（新一局/导入 PBN 共用）。 */
  function beginAuction(
    hands: Record<Position, Hand>,
    dealer: Position,
    vulnerability: GameState['vulnerability'],
    message: string,
    opts?: BeginAuctionOptions,
  ): void {
    const engine =
      opts?.engine ??
      buildEngineSnapshot({
        dealSource: { kind: 'imported-pbn' },
        streams: deriveImportedSeeds(state.rngSeed),
      });
    const boardNumber = opts?.boardNumber ?? Math.max(1, gamesPlayed.value);
    const createdAt = opts?.createdAt ?? engine.snapshotAt ?? new Date().toISOString();

    dealPbnText.value = opts?.pbn ?? toPbnDeal(hands, dealer);
    dealEngine.value = deepCopy(engine);
    dealRecordId.value = opts?.recordId ?? createRecordId();
    dealCreatedAt.value = createdAt;
    dealDealId.value = opts?.dealId ?? createDealId(boardNumber);
    dealBoardNumber.value = boardNumber;
    dealScoreSource.value = opts?.scoreSource ?? 'computed';
    dealStatus.value = opts?.status ?? null;
    dealAdjustment.value = opts?.adjustment;
    dealAdjustHistory.value = opts?.adjustHistory;
    dealUpdatedAt.value = opts?.updatedAt;

    currentEventLog = new EventLog({
      sessionId: LOCAL_SESSION_ID,
      tableId: LOCAL_TABLE_ID,
      tableBoardId: dealRecordId.value,
    });
    boardCompletedEventEmitted = false;
    currentEventLog.append(
      'deal.created',
      {
        dealId: dealDealId.value,
        boardNumber,
        dealer,
        vulnerability: toRecordVulnerability(vulnerability),
        pbn: dealPbnText.value,
      },
      { actor: { kind: 'system' } },
    );

    (['N', 'E', 'S', 'W'] as Position[]).forEach((p) => {
      state.hands[p] = sortHand(hands[p]);
    });
    dealHands.value = deepCopy(state.hands);
    dealHcp.value = {
      NS: hcp(state.hands.N) + hcp(state.hands.S),
      EW: hcp(state.hands.E) + hcp(state.hands.W),
    };

    state.vulnerability = vulnerability;
    state.dealer = dealer;
    state.phase = 'bidding';
    state.biddingHistory = [];
    state.currentBid = null;
    state.doubleState = 'none';
    state.currentBidder = dealer;
    state.contract = null;
    state.tricks = [];
    state.currentTrick = [];
    state.trickLeader = null;
    state.nextPlayer = null;
    state.dummyOpen = false;
    lastPlayAt = 0;
    lastTrickCompletedAt = 0;
    state.score = { NS: 0, EW: 0 };
    state.isAiThinking = false;
    state.message = message;
    bidPreview.value = null;
    freezeBiddingRulesForDeal();
  }

  function startNewGame(opts: StartOptions = {}): void {
    loopToken++; // 取消进行中的 AI 循环
    archiveCurrentDeal(); // 归档上一局
    gamesPlayed.value += 1;
    consumeHintsTrialDeal();

    const baseSeed = opts.seed !== undefined ? opts.seed >>> 0 : randomSeed();
    const index = opts.index ?? 0;
    const streams = deriveStreamSeeds(baseSeed, index);
    state.rngSeed = streams.deal;
    dealRng = makeRng(streams.deal);
    biddingRng = makeRng(streams.bidding);
    playRng = makeRng(streams.play);
    ddsRng = makeRng(streams.dds);

    // 发牌（deal 流消费顺序固定：洗牌 → 局况 → 后续只能追加）
    const deck = shuffle(createDeck(), dealRng);
    const dealt = deal(deck);

    // 局况：等概率随机（验收要求）
    const vulnerability = VULNERABILITIES[Math.floor(dealRng() * VULNERABILITIES.length)];

    // 庄家轮转：首局 N，其后顺时针推进
    const dealer = opts.dealer ?? (gamesPlayed.value === 1 ? 'N' : nextPosition(state.dealer));

    const boardNumber = gamesPlayed.value;
    const engine = buildEngineSnapshot({
      dealSource: { kind: 'seeded', baseSeed, index },
      streams,
    });
    beginAuction(
      dealt,
      dealer,
      vulnerability,
      `第 ${boardNumber} 局开始，庄家 ${dealer}，局况 ${vulName(vulnerability)}`,
      {
        engine,
        pbn: toPbnDeal(dealt, dealer),
        recordId: createRecordId(),
        createdAt: engine.snapshotAt ?? new Date().toISOString(),
        dealId: createDealId(boardNumber),
        boardNumber,
      },
    );

    if (opts.autoStart !== false) void runAILoop();
  }

  /** 导出当前牌局（使用发牌快照，避免打牌后手牌已消耗）。 */
  function exportDealPbn(): string {
    const snapshot = dealHands.value;
    const hands = (['N', 'E', 'S', 'W'] as Position[]).every((p) => snapshot[p]?.length === 13)
      ? snapshot
      : state.hands;
    const total = (['N', 'E', 'S', 'W'] as Position[]).reduce((sum, p) => sum + (hands[p]?.length ?? 0), 0);
    if (total !== 52) throw new Error('当前没有可导出的完整牌局');
    return toPbnDeal(hands, state.dealer);
  }

  interface ImportDealOptions {
    /** PBN 不含局况，导入时可指定；默认沿用当前局况 */
    vulnerability?: GameState['vulnerability'];
    /** 可选基础种子，使导入后的 bidding/play/dds 流可复现 */
    seed?: number;
    index?: number;
    autoStart?: boolean;
  }

  /** 从 PBN 发牌字符串导入并开始一副新牌。 */
  function importDealPbn(text: string, opts: ImportDealOptions = {}): void {
    const parsed = parsePbnDeal(text);
    loopToken++;
    archiveCurrentDeal();
    gamesPlayed.value += 1;
    consumeHintsTrialDeal();

    const baseSeed = opts.seed !== undefined ? opts.seed >>> 0 : randomSeed();
    const index = opts.index ?? 0;
    const streams = deriveImportedSeeds(baseSeed, index);
    state.rngSeed = streams.bidding;
    dealRng = makeRng(streams.bidding);
    biddingRng = makeRng(streams.bidding);
    playRng = makeRng(streams.play);
    ddsRng = makeRng(streams.dds);

    const vulnerability = opts.vulnerability ?? state.vulnerability;
    const boardNumber = gamesPlayed.value;
    const engine = buildEngineSnapshot({
      dealSource: { kind: 'imported-pbn' },
      streams,
    });
    beginAuction(
      parsed.hands,
      parsed.dealer,
      vulnerability,
      `导入 PBN：第 ${boardNumber} 局，庄家 ${parsed.dealer}，局况 ${vulName(vulnerability)}`,
      {
        engine,
        pbn: toPbnDeal(parsed.hands, parsed.dealer),
        recordId: createRecordId(),
        createdAt: engine.snapshotAt ?? new Date().toISOString(),
        dealId: createDealId(boardNumber),
        boardNumber,
      },
    );
    if (opts.autoStart !== false) void runAILoop();
  }

  /* ---------------------------------------------------------------- *
   * TableBoard / PBN / CSV 数据交换
   * ---------------------------------------------------------------- */

  function fallbackEngine(): EngineSnapshot {
    return buildEngineSnapshot({
      dealSource: { kind: 'imported-pbn' },
      streams: deriveImportedSeeds(state.rngSeed),
    });
  }

  /** 当前副 → Profile S 记录（使用开局快照，而非打牌后的残局）。 */
  function currentTableBoardRecord(): TableBoardRecord {
    const total = (['N', 'E', 'S', 'W'] as Position[]).reduce(
      (sum, seat) => sum + (dealHands.value[seat]?.length ?? 0),
      0,
    );
    if (total !== 52) throw new Error('当前没有可导出的完整牌局');
    const boardNumber = dealBoardNumber.value || Math.max(1, gamesPlayed.value);
    return buildTableBoardRecord({
      ...(dealRecordId.value ? { recordId: dealRecordId.value } : {}),
      ...(dealCreatedAt.value ? { createdAt: dealCreatedAt.value } : {}),
      ...(dealDealId.value ? { dealId: dealDealId.value } : {}),
      boardNumber,
      dealer: state.dealer,
      vulnerability: state.vulnerability,
      hands: dealHands.value,
      pbn: dealPbnText.value || toPbnDeal(dealHands.value, state.dealer),
      biddingHistory: state.biddingHistory,
      contract: state.contract,
      tricks: state.tricks,
      score: state.score,
      scoreSource: dealScoreSource.value,
      ...(dealStatus.value ? { status: dealStatus.value } : {}),
      ...(dealAdjustment.value ? { adjustment: dealAdjustment.value } : {}),
      ...(dealAdjustHistory.value ? { adjustHistory: dealAdjustHistory.value } : {}),
      ...(dealUpdatedAt.value ? { updatedAt: dealUpdatedAt.value } : {}),
      hcp: { NS: dealHcp.value.NS, EW: dealHcp.value.EW },
      engine: dealEngine.value ?? fallbackEngine(),
    });
  }

  function archivedTableBoardRecord(record: DealRecord): TableBoardRecord {
    const hands = record.hands;
    if (!hands || (['N', 'E', 'S', 'W'] as Position[]).some((seat) => hands[seat]?.length !== 13)) {
      throw new Error(`第 ${record.index} 局缺少完整发牌快照，无法导出`);
    }
    return buildTableBoardRecord({
      ...(record.recordId ? { recordId: record.recordId } : {}),
      ...(record.createdAt ? { createdAt: record.createdAt } : {}),
      ...(record.dealId ? { dealId: record.dealId } : {}),
      boardNumber: record.boardNumber ?? Math.max(1, record.index),
      dealer: record.dealer,
      vulnerability: record.vulnerability,
      hands,
      biddingHistory: record.biddingHistory,
      contract: record.contract,
      tricks: record.tricks,
      score: record.score,
      scoreSource: record.scoreSource ?? 'computed',
      hcp: { NS: record.hcp.NS, EW: record.hcp.EW },
      engine: record.engine ?? fallbackEngine(),
      auctionCompleted:
        record.contract !== null ||
        auctionOutcome(record.biddingHistory, lastBidOf(record.biddingHistory)) !== 'none',
    });
  }

  /** 历史记录 + 当前副（按时间顺序）。 */
  function tableBoardRecords(): TableBoardRecord[] {
    const records = dealHistory.value.map(archivedTableBoardRecord);
    const total = (['N', 'E', 'S', 'W'] as Position[]).reduce(
      (sum, seat) => sum + (dealHands.value[seat]?.length ?? 0),
      0,
    );
    if (total === 52) records.push(currentTableBoardRecord());
    return records;
  }

  /** 当前副的事件流（JSONL）；导出当前副的审计/回放事件。 */
  function exportEventJsonl(): string {
    return currentEventLog?.toJsonl() ?? '';
  }

  /** 当前副的 Profile S JSON。 */
  function exportTableBoardJson(): string {
    return toTableBoardJson(currentTableBoardRecord());
  }

  /** 当前副的完整 PBN（含 Auction / Contract / Result / Play / Score）。 */
  function exportTableBoardPbn(): { text: string; losses: LossReport[] } {
    return tableBoardToPbn(currentTableBoardRecord());
  }

  /** 历史 + 当前副的 CSV（UTF-8 BOM）。 */
  function exportTableBoardCsv(): string {
    return toTableBoardCsv(tableBoardRecords());
  }

  /** 兼容便捷入口：只导出完整 PBN 文本。 */
  function exportTableBoardPbnText(): string {
    return toPbnRecordText(currentTableBoardRecord());
  }

  interface ImportRecordOptions {
    autoStart?: boolean;
  }

  interface ImportBoardPbnOptions extends ImportRecordOptions {
    vulnerability?: RecordVulnerability;
    seed?: number;
    index?: number;
  }

  /** 把一条 TableBoard 记录装载为当前副（不运行 AI，除非显式要求）。 */
  function importTableBoardRecord(record: TableBoardRecord, opts: ImportRecordOptions = {}): void {
    const parsed = parsePbnDeal(record.deal.pbn);
    loopToken++;
    archiveCurrentDeal();
    gamesPlayed.value += 1;
    consumeHintsTrialDeal();

    const streams = record.engine.streams ?? {};
    const fallbackSeed =
      record.engine.dealSource.kind === 'seeded'
        ? record.engine.dealSource.baseSeed
        : (record.engine.rngSeed ?? randomSeed());
    const effectiveSeed = streams.deal ?? streams.bidding ?? fallbackSeed;
    state.rngSeed = effectiveSeed >>> 0;
    dealRng = makeRng(state.rngSeed);
    biddingRng = makeRng((streams.bidding ?? effectiveSeed) >>> 0);
    playRng = makeRng((streams.play ?? effectiveSeed) >>> 0);
    ddsRng = makeRng((streams.dds ?? effectiveSeed) >>> 0);

    const boardNumber = record.deal.boardNumber;
    const status = preservedRecordStatus(record);
    beginAuction(
      parsed.hands,
      record.deal.dealer,
      toInternalVulnerability(record.deal.vulnerability),
      `导入记录：第 ${boardNumber} 局，庄家 ${record.deal.dealer}`,
      {
        engine: deepCopy(record.engine),
        pbn: record.deal.pbn,
        recordId: record.recordId,
        createdAt: record.createdAt,
        dealId: record.deal.dealId,
        boardNumber,
        scoreSource: record.score.source,
        ...(status ? { status } : {}),
        ...(record.adjustment ? { adjustment: record.adjustment } : {}),
        ...(record.adjustHistory ? { adjustHistory: record.adjustHistory } : {}),
        ...(record.updatedAt ? { updatedAt: record.updatedAt } : {}),
      },
    );

    // 叫牌历史
    let position = record.deal.dealer;
    let currentBid: GameState['currentBid'] = null;
    let doubleState: GameState['doubleState'] = 'none';
    const history: BidRecord[] = [];
    for (const code of record.auction.calls) {
      const call = callFromCode(code);
      history.push({ position, call });
      if (call.type === 'bid') {
        currentBid = { level: call.level, suit: call.suit };
        doubleState = 'none';
      } else if (call.type === 'double') {
        doubleState = 'double';
      } else if (call.type === 'redouble') {
        doubleState = 'redouble';
      }
      position = nextPosition(position);
    }
    state.biddingHistory = history;
    state.currentBid = currentBid;
    state.doubleState = doubleState;
    state.currentBidder = position;

    // 定约与出牌
    if (
      record.contract &&
      record.declarer &&
      record.status !== 'PASSED_OUT' &&
      record.status !== 'CANCELLED' &&
      record.status !== 'REOPENED' &&
      record.status !== 'INCOMPLETE'
    ) {
      state.contract = contractFromRecord(record.contract, record.declarer);
    }
    const restoredTricks: Trick[] = [];
    if (record.play && state.contract) {
      for (const trick of record.play.tricks) {
        restoredTricks.push({
          leader: trick.leader,
          winner: trick.winner,
          plays: trick.cards.map((item) => ({
            position: item.seat,
            card: tokenToCard(item.card),
          })),
        });
      }
    }
    state.tricks = restoredTricks;
    state.currentTrick = [];
    const played = new Set(
      record.play?.tricks.flatMap((trick) =>
        trick.cards.map((item) => tokenToCard(item.card)),
      ) ?? [],
    );
    for (const seat of ['N', 'E', 'S', 'W'] as Position[]) {
      state.hands[seat] = state.hands[seat].filter((card) => !played.has(card));
    }

    const rawScore = record.score.nsRaw ?? 0;
    state.score = {
      NS: Math.max(0, rawScore),
      EW: Math.max(0, -rawScore),
    };

    if (
      record.status === 'PASSED_OUT' ||
      record.status === 'CANCELLED' ||
      record.status === 'INCOMPLETE' ||
      record.status === 'REOPENED'
    ) {
      state.contract = null;
      state.tricks = [];
      state.score = { NS: 0, EW: 0 };
      state.phase = 'scoring';
    } else if (record.status === 'PLAYED' || record.status === 'ADJUSTED') {
      state.phase = 'scoring';
      state.dummyOpen = restoredTricks.length > 0;
    } else if (!record.auction.completed) {
      state.phase = 'bidding';
      state.currentBidder = position;
    } else if (state.contract) {
      const leader =
        restoredTricks.length > 0
          ? restoredTricks[restoredTricks.length - 1].winner
          : nextPosition(state.contract.declarer);
      state.phase = 'play_waiting_lead';
      state.trickLeader = leader;
      state.nextPlayer = leader;
      state.dummyOpen = restoredTricks.length > 0;
    } else {
      state.phase = 'bidding';
    }

    state.isAiThinking = false;
    state.message = `已导入第 ${boardNumber} 局记录（${record.status}）`;

    if (
      opts.autoStart !== false &&
      (state.phase === 'bidding' || state.phase === 'play_waiting_lead')
    ) {
      void runAILoop();
    }
  }

  /** JSON 文本 → 当前副；返回 warning / info 级诊断供 UI 展示。 */
  function importTableBoardJson(text: string, opts: ImportRecordOptions = {}): ExchangeIssue[] {
    const { record, issues } = parseTableBoardRecordDetailed(text);
    importTableBoardRecord(record, opts);
    return issues;
  }

  /** 完整 PBN 文本 → 当前副；返回警告/损失报告供 UI 展示。 */
  function importTableBoardPbn(
    text: string,
    opts: ImportBoardPbnOptions = {},
  ): ExchangeIssue[] {
    const baseSeed = opts.seed !== undefined ? opts.seed >>> 0 : randomSeed();
    const streams = deriveImportedSeeds(baseSeed, opts.index ?? 0);
    const engine = buildEngineSnapshot({
      dealSource: { kind: 'imported-pbn' },
      streams,
    });
    const { record, issues, losses } = tableBoardFromPbn(text, {
      engine,
      ...(opts.vulnerability ? { vulnerability: opts.vulnerability } : {}),
    });
    importTableBoardRecord(record, { ...(opts.autoStart !== undefined ? { autoStart: opts.autoStart } : {}) });
    return [
      ...issues,
      ...losses.map((loss) => ({
        code: 'LOSS_REPORT',
        severity: 'info' as const,
        message: `${loss.field}: ${loss.reason}`,
        field: loss.field,
      })),
    ];
  }

  /** 人类叫牌（仅受核心法律约束，可诈叫） */
  async function humanBid(call: BidCall, meta?: { alerted?: boolean; alertText?: string }): Promise<void> {
    if (state.phase !== 'bidding') return;
    const pos = state.currentBidder;
    if (!isHumanControlled(pos)) return;
    if (!isCallLegal(state.biddingHistory, state.currentBid, pos, call)) {
      state.message = '该叫品不合法';
      return;
    }
    // 人类叫牌同样记录匹配到的规则，供叫牌含义浮窗稳定显示。
    const candidate = findCandidateForCall(
      state.hands[pos],
      state.biddingHistory,
      pos,
      state.currentBid,
      state.styles[pos].bid,
      activeBiddingRules.value,
      call,
    );
    bidPreview.value = null;
    applyBid(pos, call, {
      ...(meta ?? {}),
      ...(candidate ? { ruleId: candidate.rule.id } : {}),
    });
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
    reloadBiddingRuleSet(name);
  }

  function setLeadRuleFile(name: string): void {
    leadRuleFile.name = name;
    leadRules.rules = loadLeadRules(name);
  }

  function setSignalRuleFile(name: string): void {
    signalRuleFile.name = name;
    const loaded = loadSignalRules(name);
    signalRuleSet.rules = loaded.rules;
    signalRuleSet.settings = loaded.settings;
  }

  /**
   * 显示/隐藏“推荐 + 浮动层解释”；关闭时立即清空叫牌预览。
   * 非会员试用用完后只能关闭，不能再次开启。
   */
  function setShowHints(value: boolean): void {
    if (value && !canEnableHints.value) {
      state.message = `非会员推荐 + 浮动层解释试用已结束（前 ${HINTS_TRIAL_DEALS} 副）`;
      return;
    }
    showHints.value = value;
    if (!value) bidPreview.value = null;
    try {
      globalThis.localStorage?.setItem(SHOW_HINTS_KEY, value ? '1' : '0');
    } catch {
      // 无 localStorage 环境（测试/隐私模式）下仅保留内存状态
    }
  }

  /**
   * 每开始一副新牌时累计非会员试用进度。
   * 前 HINTS_TRIAL_DEALS 副仍可用；开始第 51 副时置为结束并自动关闭。
   */
  function consumeHintsTrialDeal(): void {
    if (isMember.value) return;
    if (hintsTrialEnded.value || hintsTrialDealsUsed.value >= HINTS_TRIAL_DEALS) {
      if (!hintsTrialEnded.value) {
        hintsTrialEnded.value = true;
        persistHintsTrialEnded();
      }
      if (showHints.value) setShowHints(false);
      return;
    }
    hintsTrialDealsUsed.value += 1;
    persistHintsTrialDeals();
  }

  /** 叫牌卡更新选择/推荐时同步到牌桌浮窗 */
  function setBidPreview(preview: BidPreview | null): void {
    bidPreview.value = showHints.value ? preview : null;
  }

  /* ---------------------------------------------------------------- *
   * 规则浏览 / 修改（叫牌 + 打牌首攻）
   * ---------------------------------------------------------------- */

  /** 读取规则源码：优先本地覆盖版本，否则内置默认 */
  function getRuleSource(kind: RuleKind, name: string): string {
    void ruleRevision.value;
    if (kind === 'bidding') return getBiddingRuleText(name);
    if (kind === 'lead') return getLeadRuleText(name);
    return getSignalRuleText(name);
  }

  /** 该规则文件是否存在本地修改 */
  function isRuleOverridden(kind: RuleKind, name: string): boolean {
    void ruleRevision.value;
    if (kind === 'bidding') return isBiddingRuleOverridden(name);
    if (kind === 'lead') return isLeadRuleOverridden(name);
    return isSignalRuleOverridden(name);
  }

  /** 校验规则源码（YAML 语法 + 必备字段），不写入 */
  function validateRuleSource(kind: RuleKind, text: string): RuleValidationResult {
    if (kind === 'bidding') return validateBiddingRuleText(text);
    if (kind === 'lead') return validateLeadRuleText(text);
    return validateSignalRuleText(text);
  }

  /** 保存并应用规则源码；校验失败会抛错，不写入 */
  function saveRuleSource(kind: RuleKind, name: string, text: string): void {
    if (!canEditRules.value) throw new Error('当前账号无规则修改权限（仅系统管理员可修改）');
    if (kind === 'bidding') {
      saveBiddingRuleText(name, text);
      if (biddingRuleFile.name === name) reloadBiddingRuleSet(name);
    } else if (kind === 'lead') {
      saveLeadRuleText(name, text);
      if (leadRuleFile.name === name) leadRules.rules = loadLeadRules(name);
    } else {
      saveSignalRuleText(name, text);
      if (signalRuleFile.name === name) setSignalRuleFile(name);
    }
    ruleRevision.value += 1;
  }

  /** 清除某个规则文件的本地修改，恢复内置默认 */
  function resetRuleSource(kind: RuleKind, name: string): void {
    if (!canEditRules.value) throw new Error('当前账号无规则修改权限（仅系统管理员可修改）');
    if (kind === 'bidding') {
      resetBiddingRuleText(name);
      if (biddingRuleFile.name === name) reloadBiddingRuleSet(name);
    } else if (kind === 'lead') {
      resetLeadRuleText(name);
      if (leadRuleFile.name === name) leadRules.rules = loadLeadRules(name);
    } else {
      resetSignalRuleText(name);
      if (signalRuleFile.name === name) setSignalRuleFile(name);
    }
    ruleRevision.value += 1;
  }

  /** 清除所有规则文件的本地修改 */
  function resetAllRuleOverrides(): void {
    if (!canEditRules.value) throw new Error('当前账号无规则修改权限（仅系统管理员可修改）');
    clearRuleOverrides();
    reloadBiddingRuleSet(biddingRuleFile.name);
    leadRules.rules = loadLeadRules(leadRuleFile.name);
    setSignalRuleFile(signalRuleFile.name);
    ruleRevision.value += 1;
  }

  /** 设置当前用户角色（接入后台登录态后由系统注入） */
  function setCurrentUserRole(role: UserRole): void {
    currentUserRole.value = role;
  }

  /** 设置会员状态（接入后台登录态后由系统注入） */
  function setMembership(value: boolean): void {
    isMember.value = value;
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

  /** 开启/关闭 DDS 深度打牌（关闭后使用原启发式，立即生效） */
  function setDdsPlayEnabled(value: boolean): void {
    useDdsPlayAI.value = value;
  }

  return {
    ...toRefs(state),
    autoPilot,
    useDdsPlayAI,
    isMember,
    showHints,
    hintsTrialDealsUsed,
    hintsTrialRemaining,
    hintsTrialExhausted,
    canEnableHints,
    bidPreview,
    dealHistory,
    gamesPlayed,
    roundSize,
    pointsSummary,
    useHcpAdjust,
    dealHcp,
    dealHands,
    // 规则资产
    biddingRules,
    activeBiddingRules,
    activeRulesetId,
    leadRules,
    signalRuleSet,
    biddingRuleFile,
    leadRuleFile,
    signalRuleFile,
    availableBiddingFiles: biddingFileNames,
    availableLeadFiles: leadFileNames,
    availableSignalFiles: signalFileNames,
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
    exportDealPbn,
    importDealPbn,
    // 数据交换（Profile S）
    dealEngine,
    currentTableBoardRecord,
    exportTableBoardJson,
    exportTableBoardPbn,
    exportTableBoardPbnText,
    exportTableBoardCsv,
    exportEventJsonl,
    importTableBoardRecord,
    importTableBoardJson,
    importTableBoardPbn,
    humanBid,
    humanPlay,
    recommendPlay,
    recommendPlayDetails,
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
    setSignalRuleFile,
    setShowHints,
    setBidPreview,
    // 规则浏览 / 修改
    getRuleSource,
    isRuleOverridden,
    validateRuleSource,
    saveRuleSource,
    resetRuleSource,
    resetAllRuleOverrides,
    setCurrentUserRole,
    setMembership,
    setAutoPilot,
    setDdsPlayEnabled,
    setRoundSize,
    setUseHcpAdjust,
  };
});

/* ------------------------------------------------------------------ *
 * 文案辅助
 * ------------------------------------------------------------------ */

/** 叫牌过程里的 Pass 统一用单横杠表示 */
export const PASS_TEXT = '—';
/** 叫牌结束符：另起一行写在第一列（上下双横杠） */
export const FINAL_PASS_TEXT = '=';

export function describeCall(call: BidCall): string {
  switch (call.type) {
    case 'pass':
      return PASS_TEXT;
    case 'bid':
      return `${call.level}${suitName(call.suit)}`;
    case 'double':
      return 'X';
    case 'redouble':
      return 'XX';
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
