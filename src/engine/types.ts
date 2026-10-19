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
  hcp?: NumRange; // 大牌点
  controls?: NumRange; // 控制点 A=2 K=1
  spades?: NumRange; // 花色长度
  hearts?: NumRange;
  diamonds?: NumRange;
  clubs?: NumRange;
  balanced?: boolean; // 均型（4-3-3-3 / 4-4-3-2 / 5-3-3-2）
  /** 首叫座位：1=发牌人，2=第二家，3=第三家，4=第四家；仅开叫时有效 */
  openingSeat?: NumRange;
  // 未来扩展位（MVP 不解析）：losers, keycards, ...
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

/** 防守信号规则：MVP 阶段仅作文档记录，程序不解析（见 rules/play/signals.yml） */
export interface SignalRule {
  id?: string;
  description?: string;
}
