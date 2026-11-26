/**
 * Treasure after a won fight, and wearing what you find.
 *
 * Coins go to everyone still standing. Sometimes one character also finds a
 * magic item, drawn from Dungeoneer's item list at a rarity that suits the
 * party's level. Found items land in the bag; ones that fit a body slot can
 * be put on from the inventory screen.
 */

import type { CharacterSheet, EquipmentSet, Item, ItemType } from '../types';
import { magicItems, type MagicItem } from '../data/dungeoneer';
import { slotForItem } from '../combat/inventory-view';

const ITEM_CHANCE = Number(process.env.LOOT_ITEM_CHANCE ?? 0.45);

const d = (sides: number) => 1 + Math.floor(Math.random() * sides);
const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

const KIND: Record<string, ItemType> = {
  'wondrous item': 'wondrous', potion: 'potion', weapon: 'weapon', ring: 'ring', wand: 'wand',
  armor: 'armor', shield: 'armor', staff: 'weapon', rod: 'wand', scroll: 'scroll', ammunition: 'gear',
};

function rarityFor(level: number): string[] {
  if (level <= 4) return ['common', 'uncommon'];
  if (level <= 10) return ['uncommon', 'rare'];
  if (level <= 16) return ['rare', 'very rare'];
  return ['very rare', 'legendary'];
}

/** The sheet's equipment as a set with a bag, converting older flat lists. */
function equipmentSet(sheet: CharacterSheet): EquipmentSet {
  if (!sheet.equipment) sheet.equipment = { inventory: [] };
  if (Array.isArray(sheet.equipment)) {
    const flat = sheet.equipment;
    sheet.equipment = {
      weapons: flat.filter(i => i.type === 'weapon' || i.damage),
      armor: flat.find(i => i.type === 'armor' && !/shield/i.test(i.name)),
      shield: flat.find(i => /shield/i.test(i.name)),
      inventory: flat.filter(i => i.type !== 'weapon' && !i.damage && i.type !== 'armor'),
    };
  }
  sheet.equipment.inventory ??= [];
  return sheet.equipment;
}

function toItem(found: MagicItem): Item {
  return {
    name: found.name,
    type: KIND[found.type.toLowerCase()] ?? 'wondrous',
    rarity: found.rarity.toLowerCase() as Item['rarity'],
    description: found.description.replace(/\*{1,3}/g, '').replace(/\s+/g, ' ').trim().slice(0, 600),
    attunement: Boolean(found.requires_attunement),
    quantity: 1,
  };
}

export interface LootResult {
  /** Lines for the adventure log. */
  lines: string[];
  /** Characters whose sheets changed. */
  changed: CharacterSheet[];
}

/** Hand out treasure to the characters who are still standing. */
export function awardLoot(party: CharacterSheet[]): LootResult {
  const standing = party.filter(c => ((c.hp ?? c.hitPoints)?.current ?? 0) > 0);
  if (standing.length === 0) return { lines: [], changed: [] };

  const level = Math.max(1, Math.round(standing.reduce((n, c) => n + c.level, 0) / standing.length));
  const gold = d(6) + d(6) + level * 2;
  for (const c of standing) {
    const set = equipmentSet(c);
    set.currency = { ...(set.currency ?? {}), gp: (set.currency?.gp ?? set.currency?.gold ?? 0) + gold };
  }
  const lines = [`Each of you pockets ${gold} gold pieces.`];

  if (Math.random() < ITEM_CHANCE) {
    const wanted = rarityFor(level);
    const pool = magicItems().filter(i => wanted.includes(i.rarity.toLowerCase()));
    if (pool.length > 0) {
      const finder = pick(standing);
      const item = toItem(pick(pool));
      equipmentSet(finder).inventory!.push(item);
      lines.push(`${finder.name} finds ${/^[aeiou]/i.test(item.name) ? 'an' : 'a'} ${item.name} (${item.rarity}).`);
    }
  }
  return { lines, changed: standing };
}

export type EquipResult = { ok: true; message: string } | { ok: false; message: string };

/** Put on a bag item that fits a body slot. Whatever was in that slot from the bag comes off. */
export function equipItem(sheet: CharacterSheet, itemName: unknown): EquipResult {
  if (typeof itemName !== 'string') return { ok: false, message: 'Pick an item first.' };
  const bag = equipmentSet(sheet).inventory!;
  const item = bag.find(i => i.name === itemName && !i.equipped);
  if (!item) return { ok: false, message: 'That item is not in your bag.' };
  const slot = slotForItem(item.name);
  if (!slot) return { ok: false, message: `${item.name} is carried, not worn.` };

  const set = equipmentSet(sheet);
  const fixed = (slot === 'chest' && set.armor) || (slot === 'offHand' && set.shield) || (slot === 'mainHand' && set.weapons?.length);
  if (fixed) return { ok: false, message: `Your ${slot === 'chest' ? 'armor' : slot === 'offHand' ? 'shield' : 'weapon'} is already there.` };

  for (const other of bag) {
    if (other.equipped && slotForItem(other.name) === slot) other.equipped = false;
  }
  item.equipped = true;
  return { ok: true, message: `puts on the ${item.name}.` };
}

export function unequipItem(sheet: CharacterSheet, itemName: unknown): EquipResult {
  if (typeof itemName !== 'string') return { ok: false, message: 'Pick an item first.' };
  const item = equipmentSet(sheet).inventory!.find(i => i.name === itemName && i.equipped);
  if (!item) return { ok: false, message: 'You are not wearing that.' };
  item.equipped = false;
  return { ok: true, message: `takes off the ${item.name}.` };
}
