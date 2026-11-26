/**
 * The battle map as the server sees it.
 *
 * Token positions live here, not in the browser: clients ask to move, the
 * server checks the request and tells everyone the result.
 */

import type { GameState } from '../campaign';
import { extractConditionNames, normalizeHP } from '../combat/condition-utils';

export const MAP_WIDTH = 30;
export const MAP_HEIGHT = 20;
const FEET_PER_SQUARE = 5;

export interface BoardToken {
  id: string;
  name: string;
  type: 'pc' | 'npc' | 'monster';
  x: number;
  y: number;
  size: number;
  hp?: { current: number; max: number };
  conditions?: string[];
}

export interface PartyMember {
  characterId: string;
  hp: { current: number; max: number };
  ac: number;
  conditions: string[];
}

export interface Board {
  tokens: Map<string, BoardToken>;
  /** Where the acting character stood when their turn began, for the movement allowance. */
  turnStart: { key: string; x: number; y: number } | null;
}

export type MoveResult =
  | { ok: true }
  | { ok: false; reason: string };

export function createBoard(): Board {
  return { tokens: new Map(), turnStart: null };
}

function occupied(board: Board, x: number, y: number, exceptId?: string): boolean {
  for (const t of board.tokens.values()) {
    if (t.id !== exceptId && t.x === x && t.y === y) return true;
  }
  return false;
}

/** Nearest free square to (x, y), searching outward in rings. */
function freeSquareNear(board: Board, x: number, y: number): { x: number; y: number } {
  for (let radius = 0; radius < Math.max(MAP_WIDTH, MAP_HEIGHT); radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const cx = x + dx;
        const cy = y + dy;
        if (cx < 0 || cy < 0 || cx >= MAP_WIDTH || cy >= MAP_HEIGHT) continue;
        if (!occupied(board, cx, cy)) return { x: cx, y: cy };
      }
    }
  }
  return { x: 0, y: 0 };
}

/**
 * Bring the board in line with the game: one token per party member, one per
 * living enemy while a fight is on, and current hit points on all of them.
 */
export function syncBoard(board: Board, state: GameState): void {
  const combat = state.combatEncounter;
  const wanted = new Set<string>();

  for (const sheet of state._characters ?? []) {
    if (!sheet.id) continue;
    wanted.add(sheet.id);
    const inFight = combat?.initiativeOrder.find(c => c.sourceId === sheet.id);
    const hp = inFight ? inFight.hp : normalizeHP(sheet);
    const conditions = extractConditionNames(inFight ? inFight.conditions : sheet.conditions ?? []);
    const existing = board.tokens.get(sheet.id);
    if (existing) {
      existing.name = sheet.name;
      existing.hp = { current: hp.current, max: hp.max };
      existing.conditions = conditions;
    } else {
      const spot = freeSquareNear(board, 4, Math.floor(MAP_HEIGHT / 2));
      board.tokens.set(sheet.id, {
        id: sheet.id, name: sheet.name, type: 'pc', size: 1, ...spot,
        hp: { current: hp.current, max: hp.max }, conditions,
      });
    }
  }

  for (const c of combat?.initiativeOrder ?? []) {
    if (c.type === 'pc' || c.hp.current <= 0) continue;
    wanted.add(c.id);
    const existing = board.tokens.get(c.id);
    if (existing) {
      existing.hp = { current: c.hp.current, max: c.hp.max };
      existing.conditions = extractConditionNames(c.conditions);
    } else {
      const spot = freeSquareNear(board, MAP_WIDTH - 8, Math.floor(MAP_HEIGHT / 2));
      board.tokens.set(c.id, {
        id: c.id, name: c.name, type: c.type === 'npc' ? 'npc' : 'monster', size: 1, ...spot,
        hp: { current: c.hp.current, max: c.hp.max },
        conditions: extractConditionNames(c.conditions),
      });
    }
  }

  for (const id of [...board.tokens.keys()]) {
    if (!wanted.has(id)) board.tokens.delete(id);
  }
  if (!combat) board.turnStart = null;
}

/**
 * A player asks to move their own token. Out of combat any free square is
 * fine. In combat it must be their turn, and the square must be within their
 * speed of where they started the turn.
 */
export function requestMove(
  board: Board,
  state: GameState,
  characterId: string,
  rawX: unknown,
  rawY: unknown,
): MoveResult {
  const token = board.tokens.get(characterId);
  if (!token) return { ok: false, reason: 'Your character is not on the map.' };
  if (typeof rawX !== 'number' || typeof rawY !== 'number' || !Number.isFinite(rawX) || !Number.isFinite(rawY)) {
    return { ok: false, reason: 'That is not a place on the map.' };
  }
  const x = Math.round(rawX);
  const y = Math.round(rawY);
  if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) {
    return { ok: false, reason: 'That is off the edge of the map.' };
  }
  if (x === token.x && y === token.y) return { ok: true };
  if (occupied(board, x, y, characterId)) {
    return { ok: false, reason: 'Something is already standing there.' };
  }

  const combat = state.combatEncounter;
  if (combat) {
    const current = combat.initiativeOrder[combat.currentTurnIndex];
    if (!current || current.sourceId !== characterId) {
      return { ok: false, reason: 'You can only move on your own turn.' };
    }
    if (current.hp.current <= 0) {
      return { ok: false, reason: 'You are down and cannot move.' };
    }
    const key = `${combat.round}:${combat.currentTurnIndex}:${characterId}`;
    if (board.turnStart?.key !== key) {
      board.turnStart = { key, x: token.x, y: token.y };
    }
    const sheet = state._characters?.find(c => c.id === characterId);
    const speed = sheet?.speed ?? 30;
    const squares = Math.max(Math.abs(x - board.turnStart.x), Math.abs(y - board.turnStart.y));
    if (squares * FEET_PER_SQUARE > speed) {
      return { ok: false, reason: `That is further than you can move this turn (${speed} ft).` };
    }
  }

  token.x = x;
  token.y = y;
  return { ok: true };
}

export function boardTokens(board: Board): BoardToken[] {
  return [...board.tokens.values()];
}

/** Hit points and conditions of the whole party, for everyone at the table. */
export function partyVitals(state: GameState): PartyMember[] {
  const combat = state.combatEncounter;
  const out: PartyMember[] = [];
  for (const sheet of state._characters ?? []) {
    if (!sheet.id) continue;
    const inFight = combat?.initiativeOrder.find(c => c.sourceId === sheet.id);
    const hp = inFight ? inFight.hp : normalizeHP(sheet);
    out.push({
      characterId: sheet.id,
      hp: { current: hp.current, max: hp.max },
      ac: inFight?.ac ?? sheet.ac ?? sheet.armorClass ?? 10,
      conditions: extractConditionNames(inFight ? inFight.conditions : sheet.conditions ?? []),
    });
  }
  return out;
}
