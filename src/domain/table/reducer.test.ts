import { describe, expect, it } from 'vitest';
import { parsePbnDeal } from '../../core/pbn';
import { getLegalCards } from '../../core/playing';
import { getSuit } from '../../models/card';
import { trumpSuitOf, type Position } from '../../models/gameState';
import { createTableState, reduceTable, settleBoard, type TableState } from './reducer';

const SAMPLE_PBN =
  'N:AKQ2.JT9.543.876 JT98.AKQ.AKQJ.T9 76543.8765.T98.A -.432.762.KQJ5432';

function initialState(): TableState {
  const hands = parsePbnDeal(SAMPLE_PBN).hands;
  return createTableState({ dealer: 'N', vulnerability: 'none', hands });
}

function call(
  state: TableState,
  position: Position,
  level: number,
  suit: 'C' | 'D' | 'H' | 'S' | 'NT',
) {
  return reduceTable(state, { type: 'call', position, call: { type: 'bid', level, suit } });
}

function pass(state: TableState, position: Position) {
  return reduceTable(state, { type: 'call', position, call: { type: 'pass' } });
}

/** N 开叫后 E/S/W 连续 Pass，进入首攻等待。 */
function auction(state: TableState, level: number, suit: 'C' | 'D' | 'H' | 'S' | 'NT'): TableState {
  let current = call(state, 'N', level, suit).state;
  current = pass(current, 'E').state;
  current = pass(current, 'S').state;
  current = pass(current, 'W').state;
  return current;
}

function playAll(state: TableState): TableState {
  let current = state;
  let guard = 0;
  while (
    (current.phase === 'play' || current.phase === 'play_waiting_lead') &&
    guard++ < 60
  ) {
    const seat = current.nextPlayer!;
    const leadSuit =
      current.currentTrick.length === 0 ? null : getSuit(current.currentTrick[0].card);
    const legal = getLegalCards(
      current.hands[seat],
      leadSuit,
      trumpSuitOf(current.contract!),
    );
    const step = reduceTable(current, { type: 'play', position: seat, card: legal[0] });
    expect(step.error).toBeUndefined();
    current = step.state;
  }
  return current;
}

describe('牌桌 reducer：叫牌', () => {
  it('1NT–P–P–P 后自动确立定约并等待首攻', () => {
    let state = initialState();
    const first = call(state, 'N', 1, 'NT');
    expect(first.error).toBeUndefined();
    expect(first.events[0].type).toBe('auction.call');
    state = first.state;
    state = pass(state, 'E').state;
    state = pass(state, 'S').state;
    const last = pass(state, 'W');
    expect(last.error).toBeUndefined();
    expect(last.state.phase).toBe('play_waiting_lead');
    expect(last.state.contract).toMatchObject({ level: 1, suit: 'NT', declarer: 'N' });
    expect(last.state.nextPlayer).toBe('E');
    expect(last.events.map((event) => event.type)).toEqual([
      'auction.call',
      'contract.set',
    ]);
  });

  it('四家 Pass 流局：不产生定约，直接 board.completed PASSED_OUT', () => {
    let state = initialState();
    for (const seat of ['N', 'E', 'S', 'W'] as Position[]) {
      state = pass(state, seat).state;
    }
    expect(state.phase).toBe('passed_out');
    expect(state.contract).toBeNull();
    expect(state.settlement).toMatchObject({ status: 'PASSED_OUT', nsRaw: 0 });
    expect(state.settlement?.singleTableImp).toBe(0);
  });

  it('拒绝不在轮次上的叫牌、非法叫品与叫牌结束后的叫品', () => {
    const state = initialState();
    expect(pass(state, 'E').error?.code).toBe('NOT_YOUR_TURN');

    const first = call(state, 'N', 1, 'S').state;
    expect(call(first, 'E', 1, 'H').error?.code).toBe('BID_ILLEGAL');

    const playing = auction(state, 1, 'NT');
    expect(pass(playing, 'E').error?.code).toBe('PHASE_INVALID');
  });
});

describe('牌桌 reducer：出牌与结算', () => {
  it('打满 13 墩后自动结算，墩数与合约分一致', () => {
    let state = auction(initialState(), 1, 'NT');
    expect(state.phase).toBe('play_waiting_lead');

    state = playAll(state);
    expect(state.phase).toBe('completed');
    expect(state.tricks).toHaveLength(13);
    expect(state.settlement?.status).toBe('PLAYED');
    expect(state.settlement?.tricksTaken).toBe(
      state.tricks.filter((trick) => trick.winner === 'N' || trick.winner === 'S').length,
    );
    expect(state.tricksTaken).toBe(state.settlement?.tricksTaken);
    expect(state.score).toEqual(state.settlement?.score);
  });

  it('出牌必须跟花色；不在手中的牌被拒绝', () => {
    const state = auction(initialState(), 1, 'NT');

    const notInHand = reduceTable(state, { type: 'play', position: 'E', card: 51 });
    expect(['CARD_NOT_IN_HAND', 'PLAY_ILLEGAL']).toContain(notInHand.error?.code ?? '');

    const outOfTurn = reduceTable(state, {
      type: 'play',
      position: 'S',
      card: state.hands.S[0],
    });
    expect(outOfTurn.error?.code).toBe('NOT_YOUR_TURN');
  });

  it('reducer 不修改输入状态', () => {
    const state = initialState();
    const before = JSON.stringify(state);
    call(state, 'N', 1, 'NT');
    pass(state, 'N');
    expect(JSON.stringify(state)).toBe(before);
  });

  it('settleBoard 对无定约返回 PASSED_OUT，对定约返回合约分', () => {
    expect(settleBoard(null, [], 'none')).toMatchObject({
      status: 'PASSED_OUT',
      nsRaw: 0,
      tricksTaken: 0,
    });

    const state = playAll(auction(initialState(), 4, 'S'));
    expect(state.settlement?.status).toBe('PLAYED');
    expect(state.settlement?.nsRaw).toBe(state.score.NS - state.score.EW);
  });

  it('settle action 对未完成牌局报 PHASE_INVALID，对已完成幂等', () => {
    expect(reduceTable(initialState(), { type: 'settle' }).error?.code).toBe('PHASE_INVALID');

    const completed = playAll(auction(initialState(), 1, 'NT'));
    const again = reduceTable(completed, { type: 'settle' });
    expect(again.error).toBeUndefined();
    expect(again.events).toEqual([]);
  });
});
