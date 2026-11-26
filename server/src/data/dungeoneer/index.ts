/**
 * Reference data from Dungeoneer (AGPL-3.0, see README.md in this folder):
 * magic items, spell text, condition rules and name lists.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));

function load<T>(file: string): T {
  const text = readFileSync(path.join(here, file), 'utf-8').replace(/^﻿/, '');
  return JSON.parse(text) as T;
}

export interface MagicItem {
  name: string;
  rarity: string;
  type: string;
  description: string;
  requires_attunement?: boolean | string;
}

interface SpellEntry {
  name: string;
  description: string;
  higher_levels?: string;
  components?: string;
  casting_time?: string;
  duration?: string;
  ritual?: boolean | string;
}

type NameLists = Record<string, { male: string[]; female: string[]; lastnames: string[] }>;

let items: MagicItem[] | null = null;
let spells: Map<string, SpellEntry> | null = null;
let conditions: { name: string; description: string }[] | null = null;
let names: NameLists | null = null;

/** Markdown-ish source text to plain sentences. */
const tidy = (text: string) =>
  text.replace(/\*{1,3}/g, '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();

export function magicItems(): MagicItem[] {
  items ??= load<MagicItem[]>('items.json').filter(i => i.name && i.description && !('table' in i));
  return items;
}

export function spellText(name: string): { description: string; castingTime?: string; duration?: string; components?: string } | null {
  if (!spells) {
    spells = new Map(load<SpellEntry[]>('spells.json').map(s => [s.name.toLowerCase(), s]));
  }
  const s = spells.get(name.toLowerCase());
  if (!s) return null;
  const higher = s.higher_levels ? `\n${tidy(String(s.higher_levels))}` : '';
  return {
    description: tidy(s.description) + higher,
    castingTime: s.casting_time,
    duration: s.duration,
    components: s.components,
  };
}

export function conditionRules(): { name: string; description: string }[] {
  conditions ??= load<{ name: string; description: string }[]>('conditions.json')
    .map(c => ({ name: c.name, description: tidy(c.description).replace(/^\s*/gm, '') }));
  return conditions;
}

const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

/** A few fresh names, so the Dungeon Master's new characters do not all sound alike. */
export function nameIdeas(count = 6): string[] {
  names ??= load<{ names: NameLists }>('names.json').names;
  const cultures = ['anglo', 'dwarven', 'fey'].filter(c => names![c]);
  const out = new Set<string>();
  for (let i = 0; i < count * 3 && out.size < count; i++) {
    const lists = names[pick(cultures)];
    const first = pick(Math.random() < 0.5 ? lists.male : lists.female);
    const last = lists.lastnames.length > 1 ? ` ${pick(lists.lastnames)}` : '';
    out.add(`${first}${last}`);
  }
  return [...out];
}
