/**
 * Turns a character sheet's equipment into what the inventory screen shows:
 * one item per body slot, plus everything else in the bag.
 */

import type { CharacterSheet, Item } from '../types';

export const BODY_SLOTS = [
  'head', 'neck', 'shoulders', 'chest', 'hands', 'legs', 'greaves', 'feet', 'mainHand', 'offHand',
] as const;
export type BodySlot = (typeof BODY_SLOTS)[number];

export interface InventoryItem {
  name: string;
  kind: string;
  quantity: number;
  /** One short line of the numbers that matter: damage, armor, properties. */
  detail: string;
  description?: string;
  rarity?: string;
  /** Bag item that fits this body slot and can be put on. */
  canEquip?: BodySlot;
  /** Worn item that came from the bag and can be taken off. */
  canRemove?: boolean;
}

export interface InventoryView {
  equipped: Record<BodySlot, InventoryItem | null>;
  bag: InventoryItem[];
  coins: { pp: number; gp: number; ep: number; sp: number; cp: number };
}

/** Where a worn item goes, judged by its name. */
const SLOT_WORDS: [RegExp, BodySlot][] = [
  [/helm|helmet|hat|hood|crown|circlet|cap\b|mask/i, 'head'],
  [/amulet|necklace|pendant|periapt|medallion|holy symbol|torc/i, 'neck'],
  [/pauldron|spaulder|shoulder|cloak|cape|mantle/i, 'shoulders'],
  [/glove|gauntlet|bracer|vambrace/i, 'hands'],
  [/greave|shin/i, 'greaves'],
  [/boot|shoe|sandal|slipper/i, 'feet'],
  [/goggles|eyes of|headband|ioun/i, 'head'],
  [/scarab|brooch|necklace of/i, 'neck'],
  [/legging|breeches|trouser|pants|cuisse|tasset|skirt|kilt/i, 'legs'],
  [/armor|armour|mail|plate|robe|vest|tunic|jerkin|hide|leather/i, 'chest'],
  [/shield|buckler/i, 'offHand'],
];

export function slotForItem(name: string): BodySlot | null {
  return slotByName(name);
}

function slotByName(name: string): BodySlot | null {
  for (const [pattern, slot] of SLOT_WORDS) if (pattern.test(name)) return slot;
  return null;
}

function view(item: Item): InventoryItem {
  const parts: string[] = [];
  if (item.damage) parts.push(`${item.damage}${item.damageType ? ` ${item.damageType}` : ''}`);
  if (typeof item.ac === 'number') parts.push(`AC ${item.ac}`);
  if (typeof item.acBonus === 'number') parts.push(`+${item.acBonus} AC`);
  if (item.range) parts.push(`range ${item.range}`);
  if (Array.isArray(item.properties) && item.properties.length > 0) {
    parts.push(item.properties.filter(p => typeof p === 'string').join(', '));
  }
  return {
    name: item.name,
    kind: item.type,
    quantity: item.quantity ?? 1,
    detail: parts.join(' · '),
    description: item.description,
    rarity: item.rarity,
  };
}

export function buildInventoryView(sheet: CharacterSheet): InventoryView {
  const equipped = Object.fromEntries(BODY_SLOTS.map(s => [s, null])) as Record<BodySlot, InventoryItem | null>;
  const bag: InventoryItem[] = [];
  const wear = (slot: BodySlot | null, item: Item) => {
    if (slot && !equipped[slot]) equipped[slot] = view(item);
    else bag.push(view(item));
  };

  const equipment = sheet.equipment;
  let currency = sheet.currency;

  if (Array.isArray(equipment)) {
    // Flat list: weapons and armor are in use unless marked otherwise.
    for (const item of equipment) {
      if (item.equipped === false) { bag.push(view(item)); continue; }
      if (item.type === 'weapon' || item.damage) wear(equipped.mainHand ? null : 'mainHand', item);
      else if (item.type === 'armor') wear(slotByName(item.name) ?? 'chest', item);
      else if (item.equipped) wear(slotByName(item.name), item);
      else bag.push(view(item));
    }
  } else if (equipment) {
    const [first, ...spare] = equipment.weapons ?? [];
    if (first) equipped.mainHand = view(first);
    if (equipment.armor) equipped.chest = view(equipment.armor);
    if (equipment.shield) equipped.offHand = view(equipment.shield);
    for (const weapon of spare) bag.push(view(weapon));
    for (const item of equipment.inventory ?? []) {
      const slot = slotByName(item.name);
      if (item.equipped && slot && !equipped[slot]) {
        equipped[slot] = { ...view(item), canRemove: true };
      } else {
        const fixed = (slot === 'chest' && equipment.armor) || (slot === 'offHand' && equipment.shield) || slot === 'mainHand';
        bag.push({ ...view(item), ...(slot && !fixed ? { canEquip: slot } : {}) });
      }
    }
    currency = equipment.currency ?? currency;
  }

  const c = currency ?? {};
  return {
    equipped,
    bag,
    coins: {
      pp: c.pp ?? c.platinum ?? 0,
      gp: c.gp ?? c.gold ?? 0,
      ep: c.ep ?? c.electrum ?? 0,
      sp: c.sp ?? c.silver ?? 0,
      cp: c.cp ?? c.copper ?? 0,
    },
  };
}
