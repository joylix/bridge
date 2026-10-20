export interface BiddingPopupPosition {
  x: number;
  y: number;
}

/**
 * 叫牌浮窗在非人类回合会被卸载，位置保存在模块级，
 * 这样下一次轮到人类叫牌时可以继续使用用户拖到的位置。
 */
let savedPosition: BiddingPopupPosition | null = null;

export function getSavedBiddingPopupPosition(): BiddingPopupPosition | null {
  return savedPosition ? { ...savedPosition } : null;
}

export function saveBiddingPopupPosition(position: BiddingPopupPosition): void {
  savedPosition = { ...position };
}
