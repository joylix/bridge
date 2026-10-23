import type { BidRecord, Position } from '../models/gameState';

/**
 * 从同伴的叫牌序列估计其 HCP 下限。
 *
 * 只处理“同伴是本副第一个实质叫牌人（开叫人）”的情况，避免把应叫/争叫
 * 误当成开叫。无法确定时返回 undefined，调用方应视为条件不成立。
 *
 * 这是一个保守估计，不追求精确区间；规则仍应优先使用明确的序列含义。
 */
export function inferPartnerHcpMin(history: BidRecord[], partner: Position): number | undefined {
  const firstBid = history.find((record) => record.call.type === 'bid');
  if (!firstBid || firstBid.position !== partner) return undefined;

  const partnerBids = history.filter(
    (record) => record.position === partner && record.call.type === 'bid',
  );
  if (partnerBids.length === 0) return undefined;

  const opening = partnerBids[0].call;
  if (opening.type !== 'bid') return undefined;

  // 精确 1C 强开叫：16+；1C-1NT 后 2H 是自然再叫（16+），2S 是越过 2H 的
  // 强再叫（19+）；1C-1NT-3NT 是 16-18 均型且无四张高花的封局，按 16+ 推断。
  // 只认 1C-1NT-再叫 且中间没有对手实质叫牌的形态，避免把竞争叫牌误读成强再叫。
  if (opening.level === 1 && opening.suit === 'C') {
    if (partnerBids.length === 1) return 16;
    const substantive = history.filter((record) => record.call.type === 'bid');
    if (substantive.length >= 3) {
      const [first, second, third] = substantive;
      if (
        first.position === partner &&
        second.position === partnerOf(partner) &&
        second.call.type === 'bid' &&
        second.call.level === 1 &&
        second.call.suit === 'NT' &&
        third.position === partner &&
        third.call.type === 'bid'
      ) {
        if (third.call.level === 2 && third.call.suit === 'S') {
          return 19;
        }
        if (third.call.level === 3 && third.call.suit === 'NT') return 16;
      }
    }
    return 16;
  }

  // 1NT 开叫 13-15；1D/1H/1S 开叫 11-15。
  if (opening.level === 1 && opening.suit === 'NT') return 13;
  if (opening.level === 1) return 11;

  // 2NT 开叫 20-21；精确 2C/2D 开叫 11-15。
  if (opening.level === 2 && opening.suit === 'NT') return 20;
  if (opening.level === 2 && (opening.suit === 'C' || opening.suit === 'D')) return 11;

  // 弱二与三阶以上阻击。
  if (opening.level === 2) return 6;
  if (opening.level >= 3) return 6;

  return undefined;
}

const SEAT_ORDER: Position[] = ['N', 'E', 'S', 'W'];

function partnerOf(position: Position): Position {
  return SEAT_ORDER[(SEAT_ORDER.indexOf(position) + 2) % 4];
}
