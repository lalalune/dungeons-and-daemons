/**
 * Scenes: the picture or map the table sees behind the story.
 *
 * The Dungeon Master names the scene at the end of each reply (SCENE: cave);
 * the server strips that line and tells every player to switch. Without an AI
 * Dungeon Master, the scene is guessed from keywords.
 */

export interface SceneDef {
  key: string;
  /** Told to the Dungeon Master so it can choose. */
  hint: string;
  words: RegExp;
}

export const SCENES: SceneDef[] = [
  { key: 'cave', hint: 'caves, tunnels, mines, sewers, dungeons and other underground places', words: /\b(cave|cavern|tunnel|mine|underground|sewer|dungeon|lair|den|cellar|basement|catacomb)/i },
  { key: 'swamp', hint: 'swamps, marshes, bogs', words: /\b(swamp|marsh|bog|fen|mire|bayou)/i },
  { key: 'desert', hint: 'deserts, dunes, sandstorms, wastelands', words: /\b(desert|dune|sandstorm|wasteland|badlands)/i },
  { key: 'ship', hint: 'aboard a ship or boat on open water', words: /\b(aboard|on deck|ship|galley|sailing|vessel|longboat)/i },
  { key: 'road', hint: 'wilderness roads, forests, rivers, waterfalls', words: /\b(road|trail|forest|woods|river|waterfall|wilderness|grove|clearing|camp)/i },
  { key: 'crypt', hint: 'graveyards, ruins, crypts, haunted houses', words: /\b(crypt|grave|tomb|ruin|haunted|mausoleum|abbey|manor|cemetery|undead)/i },
  { key: 'coast', hint: 'islands, shores, harbours, lakes', words: /\b(island|shore|coast|harbou?r|dock|beach|lake|pier)/i },
  { key: 'siege', hint: 'a town under attack, battlefields, riots, burning streets', words: /\b(siege|under attack|battlefield|riot|raid|burning|invasion|ambush)/i },
  { key: 'infernal', hint: 'hellish or demonic places, cult temples, great fires', words: /\b(hell|infernal|demon|devil|cult|temple of|lava|brimstone)/i },
  { key: 'mountain', hint: 'mountains, cliffs, snowfields, high passes', words: /\b(mountain|cliff|peak|snow|glacier|pass\b|summit|ridge)/i },
  { key: 'dragon', hint: 'facing a dragon or other great monster in the open', words: /\b(dragon|wyrm|wyvern|drake)/i },
  { key: 'village', hint: 'villages, towns, castles, inns, markets and other settled places', words: /\b(village|town|city|castle|inn|tavern|market|square|keep|shop|festival|palace|street)/i },
];

export const DEFAULT_SCENE = 'village';
const KEYS = new Set(SCENES.map(s => s.key));

export function isScene(key: unknown): key is string {
  return typeof key === 'string' && KEYS.has(key);
}

/** Best keyword match in a piece of text, or null when nothing fits. */
export function sceneFromText(text: string): string | null {
  let best: { key: string; at: number } | null = null;
  for (const scene of SCENES) {
    const at = text.search(scene.words);
    if (at >= 0 && (!best || at < best.at)) best = { key: scene.key, at };
  }
  return best?.key ?? null;
}

/** The instruction added to the Dungeon Master's prompt. */
export function sceneInstruction(current: string | undefined): string {
  return [
    `After your narration, add one last line in the form "SCENE: word", where word is where the party is now.`,
    `Choose from: ${SCENES.map(s => `${s.key} (${s.hint})`).join('; ')}.`,
    current ? `The current scene is ${current}; keep it unless the party has clearly gone somewhere else.` : '',
  ].filter(Boolean).join(' ');
}

/** Split a reply into the narration players read and the scene it named. */
export function splitSceneTag(reply: string): { text: string; scene: string | null } {
  const match = reply.match(/\n?[ \t]*\**SCENE:\**[ \t]*([a-z]+)\**[ \t.]*$/i);
  if (!match) return { text: reply.trim(), scene: null };
  const key = match[1].toLowerCase();
  return { text: reply.slice(0, match.index).trim(), scene: KEYS.has(key) ? key : null };
}
