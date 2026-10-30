/**
 * TableBoard 记录 CSV 导出（UTF-8 BOM，一行一副）。
 *
 * CSV 只作为计分/复盘汇总；权威记录仍以 JSON 为准。PBN 的完整信息
 * 不在 CSV 中，导出时由调用方在 UI 中说明。
 */

import type { TableBoardRecord } from './types';
import { impsFromScoreDiff } from '../core/imps';

export const CSV_HEADER = [
  'board',
  'dealId',
  'recordId',
  'dealer',
  'vulnerability',
  'status',
  'contract',
  'declarer',
  'tricksTaken',
  'nsRaw',
  'nsHcp',
  'ewHcp',
  'singleTableImp',
  'rulesetId',
  'createdAt',
] as const;

function escapeCell(value: string | number | null | undefined): string {
  if (value === undefined || value === null) return '';
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function contractText(record: TableBoardRecord): string {
  if (!record.contract) return '';
  const doubled =
    record.contract.doubled === 'XX' ? 'XX' : record.contract.doubled === 'X' ? 'X' : '';
  return `${record.contract.level}${record.contract.denomination}${doubled}`;
}

export function tableBoardToCsvRow(record: TableBoardRecord): string {
  return [
    record.deal.boardNumber,
    record.deal.dealId,
    record.recordId,
    record.deal.dealer,
    record.deal.vulnerability,
    record.status,
    contractText(record),
    record.declarer,
    record.tricksTaken,
    record.score.nsRaw,
    record.hcp.ns,
    record.hcp.ew,
    record.score.nsRaw === null ? null : impsFromScoreDiff(record.score.nsRaw),
    record.engine.ruleset.rulesetId,
    record.createdAt,
  ]
    .map(escapeCell)
    .join(',');
}

export function toTableBoardCsv(records: TableBoardRecord[], options: { bom?: boolean } = {}): string {
  const lines = [CSV_HEADER.join(','), ...records.map(tableBoardToCsvRow)];
  const text = `${lines.join('\n')}\n`;
  return options.bom === false ? text : `\uFEFF${text}`;
}
