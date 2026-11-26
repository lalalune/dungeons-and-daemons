/**
 * Dice the whole table can see.
 *
 * Players roll checks straight from their character sheet (the server adds the
 * right modifier) or throw loose dice like 2d6+3. The server does the rolling,
 * so nobody can invent a result.
 */

import type { CharacterSheet } from '../types';
import { executeDiceRoll, parseDiceNotation } from '../types';
import { buildSheetView } from '../combat/sheet-view';

export type RollMode = 'normal' | 'advantage' | 'disadvantage';

export interface RollRequest {
  kind?: unknown;
  /** Ability or save key (str, dex...), or a skill name. */
  key?: unknown;
  /** Dice notation for loose dice, e.g. "2d6+3". */
  notation?: unknown;
  mode?: unknown;
}

export interface RollOutcome {
  /** "Arcana check", "Dexterity save", "2d6+3" */
  label: string;
  /** "d20 (14) + 5" */
  detail: string;
  total: number;
  /** Set on a d20 that came up 20 or 1. */
  natural?: 20 | 1;
  /** True for rolls made from the sheet, which the Dungeon Master should resolve. */
  isCheck: boolean;
}

const MAX_DICE = 20;
const signed = (n: number) => (n === 0 ? '' : n > 0 ? ` + ${n}` : ` - ${Math.abs(n)}`);

function d20(modifier: number, mode: RollMode): Pick<RollOutcome, 'detail' | 'total' | 'natural'> {
  const result = executeDiceRoll({
    count: 1, die: 'd20', modifier,
    advantage: mode === 'advantage', disadvantage: mode === 'disadvantage',
  });
  const kept = result.keptRoll ?? result.naturalRoll;
  const dice = result.advantageRolls
    ? `d20 (${result.advantageRolls[0]}, ${result.advantageRolls[1]}: ${mode} keeps ${kept})`
    : `d20 (${kept})`;
  return {
    detail: `${dice}${signed(modifier)}`,
    total: result.total,
    natural: kept === 20 ? 20 : kept === 1 ? 1 : undefined,
  };
}

export function resolveRoll(sheet: CharacterSheet, request: RollRequest): RollOutcome | null {
  const mode: RollMode = request.mode === 'advantage' || request.mode === 'disadvantage' ? request.mode : 'normal';

  if (request.kind === 'dice') {
    if (typeof request.notation !== 'string' || request.notation.length > 12) return null;
    const notation = request.notation.replace(/\s+/g, '').toLowerCase();
    try {
      const roll = parseDiceNotation(notation);
      if (roll.count < 1 || roll.count > MAX_DICE || Math.abs(roll.modifier) > 100) return null;
      const result = executeDiceRoll(roll);
      return {
        label: notation,
        detail: `${roll.count}${roll.die} (${result.individualRolls.join(', ')})${signed(roll.modifier)}`,
        total: result.total,
        natural: roll.count === 1 && roll.die === 'd20'
          ? (result.individualRolls[0] === 20 ? 20 : result.individualRolls[0] === 1 ? 1 : undefined)
          : undefined,
        isCheck: false,
      };
    } catch {
      return null;
    }
  }

  if (typeof request.key !== 'string') return null;
  const key = request.key.trim().toLowerCase();
  const view = buildSheetView(sheet);

  if (request.kind === 'ability') {
    const ability = view.abilities.find(a => a.key === key);
    return ability ? { label: `${ability.name} check`, ...d20(ability.modifier, mode), isCheck: true } : null;
  }
  if (request.kind === 'save') {
    const save = view.savingThrows.find(s => s.key === key);
    return save ? { label: `${save.name} saving throw`, ...d20(save.modifier, mode), isCheck: true } : null;
  }
  if (request.kind === 'skill') {
    const skill = view.skills.find(s => s.name.toLowerCase() === key);
    return skill ? { label: `${skill.name} check`, ...d20(skill.modifier, mode), isCheck: true } : null;
  }
  return null;
}
