import type { BidCall, StyleLevel } from '../models/gameState';

/** 叫牌规则（冻结接口） */
export interface BiddingRule {
  id: string;
  description: string;
  /** 叫牌序列模式：相对座位 token 序列，默认从历史末尾匹配（见 matcher.matchSequence） */
  sequence: string;
  /** 条件组合（扁平 AND，词表见 ConditionSpec） */
  when: ConditionSpec;
  /** 动作：叫品字符串，如 "1C" / "Pass" / "X" / "XX" */
  action: string;
  /** 优先级，越大越先裁决 */
  priority: number;
  /** 可选：覆盖部分风格阈值（不复制规则，仅调参） */
  style?: Partial<StyleParams>;
}

/**
 * 条件词表（封闭集合，冻结）。所有条件均为“手牌特征 vs 取值/区间”，可组合（AND）。
 * 座位关系由 sequence 的相对座位 token 表达，故此处无 position 字段。
 */
export interface ConditionSpec {
  hcp?: NumRange; // 原始大牌点（计分/贴点也使用这个值）
  /** 调整点（Adjusted Points, AP）：仅用于叫牌门槛，不参与计分/贴点 */
  adjustedHcp?: NumRange;
  controls?: NumRange; // 控制点 A=2 K=1
  spades?: NumRange; // 花色长度
  hearts?: NumRange;
  diamonds?: NumRange;
  clubs?: NumRange;
  balanced?: boolean; // 均型（4-3-3-3 / 4-4-3-2 / 5-3-3-2）
  /** 首叫座位：1=发牌人，2=第二家，3=第三家，4=第四家；仅开叫时有效 */
  openingSeat?: NumRange;
  /** 失张数（简单 LTC，0-12；越小牌越好） */
  losers?: NumRange;
  /** 缺门 / 单张 / 双张的花色数 */
  voids?: NumRange;
  singletons?: NumRange;
  doubletons?: NumRange;
  /** 至少有一门 4+ / 5+ 高花（斯台曼等约定叫常用） */
  fourCardMajor?: boolean;
  fiveCardMajor?: boolean;
  /** A / K 的张数 */
  aces?: NumRange;
  kings?: NumRange;
  /** 指定花色的挡张，如 "SHD" 表示黑桃、红桃、方块均有挡张 */
  stoppers?: string;
  /** 坚固长套，如 "CD" 表示梅花或方块中有一门 7+ 张且 A/K/Q 齐全 */
  solidSuit?: string;
  /** 没有任何 5+ 张长套（强牌扣叫的“无长套”语义） */
  noLongSuit?: boolean;
  /** 除指定花色外没有 5+ 张长套，如 "H" 表示允许 5+ 红桃，其余花色最多 4 张 */
  noLongSuitExcept?: string;
  /**
   * 敌方最后叫过花色的第一轮控制：缺门/单张，或 Ax。
   * 用于强牌扣叫；无对手花色上下文时不成立。
   */
  opponentSuitFirstControl?: boolean;
  /** 敌方最后叫过花色有挡张（用于自然新花后的 3NT 选择） */
  opponentSuitStopper?: boolean;
  /** 敌方最后叫过花色不是该字母（避免把敌方花色当自然长套叫出） */
  opponentSuitNot?: string;
  /** 扣叫花色有挡张（用于扣叫后的 3NT 选择） */
  cueSuitStopper?: boolean;

  // —— 叫牌进程上下文（由 matcher 从叫牌历史推断，不是手牌特征）——
  /** 同伴最后叫牌是扣叫（叫了敌方已叫过的花色） */
  partnerCueBid?: boolean;
  /** 自己最后叫牌是扣叫 */
  myCueBid?: boolean;
  /** 本副我方已经出现过扣叫 */
  cueBidActive?: boolean;
  /** 我方扣叫的花色字母，如 "S" */
  cueBidSuit?: string;
  /** 我方扣叫的花色不是该字母（用于“扣叫敌方花色时不能自然叫该花色”） */
  cueBidSuitNot?: string;
  /** 我方扣叫的阶数 */
  cueBidLevel?: NumRange;
  /** 同伴最后叫出的自然花色字母 */
  partnerSuit?: string;
  /** 自己最后叫出的自然花色字母 */
  mySuit?: string;
  /** 同伴最后叫牌是自然花色 */
  partnerNaturalSuit?: boolean;
  /** 自己最后叫牌是自然花色 */
  myNaturalSuit?: boolean;
  /** 同伴最后叫牌是强自然新花（规则 id 以 nat_ 开头） */
  partnerForcingNewSuit?: boolean;
  /** 自己最后叫牌是强自然新花（规则 id 以 nat_ 开头） */
  myForcingNewSuit?: boolean;
  /** 最后实质叫牌的花色字母；"NT" 表示无将 */
  lastBidSuit?: string;
  /** 最后实质叫牌的阶数 */
  lastBidLevel?: NumRange;
  /** 同伴最后叫牌是 4NT（扣叫后的满贯试探/Blackwood） */
  partnerBlackwood?: boolean;
  /** 自己最后叫牌是 4NT */
  myBlackwood?: boolean;
  /** Blackwood 约定将牌（4NT 前同伴最后自然花色） */
  agreedSuit?: string;
  /** 联手 A 数：自己 A 数 + 同伴 Blackwood 应答显示的 A 数 */
  combinedAces?: NumRange;
  /** 同伴是否是本副第一个实质叫牌人（用于区分“应叫开叫”与“应叫争叫/再叫”） */
  partnerOpened?: boolean;
  /** 同伴点力估计下限（由叫牌序列推断；仅用于明确含义的叫品） */
  partnerHcp?: NumRange;
  /** 联手点力估计下限：自己 HCP + 同伴 HCP 下限 */
  combinedHcp?: NumRange;
}

/** "16-40" / "5+" / "0-7" / "12" / 可含风格变量 "${open1ntMin}-15" */
export type NumRange = string;

/** 首攻规则（冻结接口） */
export interface LeadRule {
  id: string;
  description: string;
  context: { contract_type: 'NT' | 'suit' };
  when: ConditionSpec;
  lead: string; // "4th_best_of_longest" / "top_of_sequence" / "4th_best_of_unbid_major"
  priority: number;
  /**
   * 适用方：defender=仅防守方 / declarer=仅庄家侧 / any=不限（默认）。
   * 如“攻敌方未叫过的高花”属于防守约定，应设为 defender。
   */
  role?: 'defender' | 'declarer' | 'any';
}

/** 风格参数表（冻结）：风格只改阈值，不复制规则文件 */
export interface StyleParams {
  open1ntMin: number; // 1NT 开叫点力下限
  open1ntMax: number; // 1NT 开叫点力上限
  overcallMinHcp: number; // 争叫点力下限
  preemptMinLen: number; // 阻击叫所需花色长度
  inviteMinHcp: number; // 邀叫点力下限
  aggression: number; // 综合激进度
}

/** 三档风格默认参数：0 保守 / 1 正常 / 2 激进 */
export const STYLE_PARAMS: Record<StyleLevel, StyleParams> = {
  0: { open1ntMin: 15, open1ntMax: 17, overcallMinHcp: 9, preemptMinLen: 7, inviteMinHcp: 12, aggression: 0 },
  1: { open1ntMin: 15, open1ntMax: 17, overcallMinHcp: 8, preemptMinLen: 6, inviteMinHcp: 11, aggression: 1 },
  2: { open1ntMin: 14, open1ntMax: 17, overcallMinHcp: 7, preemptMinLen: 6, inviteMinHcp: 10, aggression: 2 },
};

/** 单个匹配结果（供裁决与探索使用） */
export interface BidCandidate {
  rule: BiddingRule;
  call: BidCall;
  /** 约束项越多 = 越具体，用于平局裁决 */
  specificity: number;
}

/** 打牌细则规则：记录跟牌/垫牌/信号约定，供规则库浏览与阈值配置。 */
export interface SignalRule {
  id: string;
  description: string;
  /** 细则阶段：跟牌 / 垫牌 / 信号 */
  phase: 'follow' | 'discard' | 'signal';
  /** 适用条件（与叫牌/首攻共用条件词表） */
  when?: ConditionSpec;
  /** 策略标识，由 ai/playAI.ts 解释执行 */
  action: string;
  priority: number;
}

/** signals.yml 中可被 AI 直接使用的阈值（牌面点数，2-14） */
export interface SignalSettings {
  /** 张数信号允许使用的最大牌面，默认 10 */
  signal_spot_max_rank?: number;
  /** 有将垫牌时“鼓励信号”的最小牌面，默认 8 */
  encourage_discard_min_rank?: number;
}

/** 解析后的打牌细则文件 */
export interface SignalRuleSet {
  rules: SignalRule[];
  settings: SignalSettings;
}
