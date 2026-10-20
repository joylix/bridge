import type { Position } from '../../models/gameState';

/**
 * 按表格列顺序放置叫牌记录。
 *
 * 叫牌按座位列排列；当下一家的列号不大于上一家时（例如从西家回到北家），
 * 说明这一行已经填满，需要换到下一行。这样南家发牌时，
 * “南 Pass、西 1C、北 Pass、东 1NT”会显示为：
 *   第一行：北 空 / 东 空 / 南 — / 西 1C
 *   第二行：北 — / 东 1NT / 南 空 / 西 空
 *
 * @returns 每条叫牌记录对应的 0 基行号
 */
export function auctionRows(positions: Position[], columns: Position[]): number[] {
  let row = 0;
  let lastColumn = -1;
  return positions.map((position) => {
    const column = columns.indexOf(position);
    if (column < 0) return row;
    if (lastColumn >= 0 && column <= lastColumn) row += 1;
    lastColumn = column;
    return row;
  });
}
