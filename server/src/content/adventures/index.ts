/**
 * The adventures a table can choose from.
 *
 * "The Goblin Den" is built in, with full locations, NPCs and quests in the
 * database. Every other adventure is a brief: a short, originally worded
 * summary the Dungeon Master improvises from. Briefs live in library.ts,
 * plus an optional private library.local.ts.
 */

import { starterCampaign, starterLocations, starterNPCs, starterQuests, openingNarration } from '../starter-adventure';
import { LIBRARY } from './library';

export interface Adventure {
  id: string;
  title: string;
  /** Author and publisher of the source the brief was written from. */
  credit: string;
  levels: string;
  tone: string;
  length: string;
  tagline: string;
  /** Spoiler-free pitch shown to players. */
  summary: string;
  startLocation: { name: string; description: string };
  /** First narration the table hears. */
  opening: string;
  /** Game-master-only outline. Never sent to players. */
  dmBrief: string;
}

export const DEFAULT_ADVENTURE_ID = 'goblin-den';

const goblinDen: Adventure = {
  id: DEFAULT_ADVENTURE_ID,
  title: starterCampaign.name,
  credit: 'Built-in starter adventure',
  levels: '1',
  tone: 'heroic, light',
  length: 'one session',
  tagline: 'A village under goblin raids needs heroes.',
  summary: starterCampaign.description.replace(/\s+/g, ' ').trim(),
  startLocation: {
    name: starterLocations[0].name,
    description: starterLocations[0].description.replace(/\s+/g, ' ').trim(),
  },
  opening: openingNarration,
  dmBrief: [
    starterCampaign.description.replace(/\s+/g, ' ').trim(),
    `Places: ${starterLocations.map(l => l.name).join(', ')}.`,
    `People: ${starterNPCs.map(n => `${n.name} (${n.occupation ?? n.type}; ${n.motivation ?? 'no stated goal'})`).join('; ')}.`,
    `Quests: ${starterQuests.map(q => `${q.name}: ${q.objectives.map(o => o.description).join(', then ')}`).join(' | ')}.`,
  ].join('\n'),
};

/**
 * Extra briefs kept only on this machine (library.local.ts is not in the
 * repository). Use it for adventures you own but may not redistribute.
 */
async function localLibrary(): Promise<Adventure[]> {
  try {
    const file = './library.local';
    const mod = (await import(file)) as { LIBRARY?: Adventure[] };
    return mod.LIBRARY ?? [];
  } catch {
    return [];
  }
}

export const ADVENTURES: Adventure[] = [goblinDen, ...LIBRARY, ...(await localLibrary())];

export function getAdventure(id: unknown): Adventure | undefined {
  return typeof id === 'string' ? ADVENTURES.find(a => a.id === id) : undefined;
}

/** What players see when choosing: everything except the game master's notes. */
export function adventureList() {
  return ADVENTURES.map(({ id, title, credit, levels, tone, length, tagline, summary }) => ({
    id, title, credit, levels, tone, length, tagline, summary,
  }));
}
