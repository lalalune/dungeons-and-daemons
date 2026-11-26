/**
 * Builds a playable level 1 character from three choices: name, race, class.
 *
 * Everything else (ability scores, hit points, armor, weapons, spells) comes
 * from the SRD tables and a starting kit per class, so a new player never
 * has to know the rules to sit down.
 */

import type { AbilityName, CharacterClass, CharacterSheet, Item, Race, Spell } from '../types';
import { SKILLS, STANDARD_ARRAY } from '../types';
import { SRD_CLASSES, getStartingHP, getSpellSlots } from '../data/srd-classes';
import { SRD_RACES, getRaceAbilityBonuses, getRaceSpeed, getRaceTraits } from '../data/srd-races';

export interface CharacterChoices {
  name: string;
  race: Race;
  class: CharacterClass;
  backstory?: string;
}

interface ClassKit {
  blurb: string;
  /** Abilities from most to least important; the standard array is dealt out in this order. */
  abilityOrder: AbilityName[];
  weapons: Item[];
  armor?: { name: string; base: number; maxDex: number | null };
  shield?: boolean;
  /** Unarmored defense: 10 + DEX + this ability. */
  unarmoredBonus?: AbilityName;
  spells?: Spell[];
}

const spell = (name: string, level: number, school: string, range: string, extra: Partial<Spell> = {}): Spell => ({
  name, level, school, castingTime: '1 action', range, ...extra,
});

const KITS: Record<CharacterClass, ClassKit> = {
  Barbarian: {
    blurb: 'Rage-fuelled bruiser. Very hard to put down.',
    abilityOrder: ['strength', 'constitution', 'dexterity', 'wisdom', 'charisma', 'intelligence'],
    weapons: [
      { name: 'Greataxe', type: 'weapon', damage: '1d12', damageType: 'slashing', properties: ['heavy', 'two-handed'] },
      { name: 'Javelin', type: 'weapon', damage: '1d6', damageType: 'piercing', properties: ['thrown'] },
    ],
    unarmoredBonus: 'constitution',
  },
  Bard: {
    blurb: 'Silver-tongued performer with a bit of every magic.',
    abilityOrder: ['charisma', 'dexterity', 'constitution', 'wisdom', 'intelligence', 'strength'],
    weapons: [{ name: 'Rapier', type: 'weapon', damage: '1d8', damageType: 'piercing', properties: ['finesse'] }],
    armor: { name: 'Leather Armor', base: 11, maxDex: null },
    spells: [
      spell('Vicious Mockery', 0, 'Enchantment', '60 feet', { damage: '1d4', damageType: 'psychic', savingThrow: 'wis' }),
      spell('Healing Word', 1, 'Evocation', '60 feet', { healing: '1d4+3' }),
      spell('Thunderwave', 1, 'Evocation', 'Self (15-foot cube)', { damage: '2d8', damageType: 'thunder', savingThrow: 'con' }),
    ],
  },
  Cleric: {
    blurb: 'Armored healer. Keeps the party standing.',
    abilityOrder: ['wisdom', 'constitution', 'strength', 'charisma', 'dexterity', 'intelligence'],
    weapons: [{ name: 'Mace', type: 'weapon', damage: '1d6', damageType: 'bludgeoning', properties: [] }],
    armor: { name: 'Scale Mail', base: 14, maxDex: 2 },
    shield: true,
    spells: [
      spell('Sacred Flame', 0, 'Evocation', '60 feet', { damage: '1d8', damageType: 'radiant', savingThrow: 'dex' }),
      spell('Cure Wounds', 1, 'Evocation', 'Touch', { healing: '1d8+3' }),
      spell('Guiding Bolt', 1, 'Evocation', '120 feet', { damage: '4d6', damageType: 'radiant', attack: true }),
    ],
  },
  Druid: {
    blurb: 'Nature caster with healing and fire.',
    abilityOrder: ['wisdom', 'constitution', 'dexterity', 'intelligence', 'charisma', 'strength'],
    weapons: [{ name: 'Scimitar', type: 'weapon', damage: '1d6', damageType: 'slashing', properties: ['finesse', 'light'] }],
    armor: { name: 'Leather Armor', base: 11, maxDex: null },
    shield: true,
    spells: [
      spell('Produce Flame', 0, 'Conjuration', '30 feet', { damage: '1d8', damageType: 'fire', attack: true }),
      spell('Cure Wounds', 1, 'Evocation', 'Touch', { healing: '1d8+3' }),
      spell('Thunderwave', 1, 'Evocation', 'Self (15-foot cube)', { damage: '2d8', damageType: 'thunder', savingThrow: 'con' }),
    ],
  },
  Fighter: {
    blurb: 'Front line. Hits hard, takes hits.',
    abilityOrder: ['strength', 'constitution', 'dexterity', 'wisdom', 'charisma', 'intelligence'],
    weapons: [
      { name: 'Longsword', type: 'weapon', damage: '1d8', damageType: 'slashing', properties: ['versatile'] },
      { name: 'Handaxe', type: 'weapon', damage: '1d6', damageType: 'slashing', properties: ['light', 'thrown'] },
    ],
    armor: { name: 'Chain Mail', base: 16, maxDex: 0 },
    shield: true,
  },
  Monk: {
    blurb: 'Fast, unarmored martial artist.',
    abilityOrder: ['dexterity', 'wisdom', 'constitution', 'strength', 'charisma', 'intelligence'],
    weapons: [
      { name: 'Shortsword', type: 'weapon', damage: '1d6', damageType: 'piercing', properties: ['finesse', 'light'] },
      { name: 'Dart', type: 'weapon', damage: '1d4', damageType: 'piercing', properties: ['finesse', 'thrown'] },
    ],
    unarmoredBonus: 'wisdom',
  },
  Paladin: {
    blurb: 'Holy knight in heavy armor.',
    abilityOrder: ['strength', 'charisma', 'constitution', 'wisdom', 'dexterity', 'intelligence'],
    weapons: [
      { name: 'Longsword', type: 'weapon', damage: '1d8', damageType: 'slashing', properties: ['versatile'] },
      { name: 'Javelin', type: 'weapon', damage: '1d6', damageType: 'piercing', properties: ['thrown'] },
    ],
    armor: { name: 'Chain Mail', base: 16, maxDex: 0 },
    shield: true,
  },
  Ranger: {
    blurb: 'Archer and tracker at home in the wild.',
    abilityOrder: ['dexterity', 'wisdom', 'constitution', 'strength', 'intelligence', 'charisma'],
    weapons: [
      { name: 'Shortsword', type: 'weapon', damage: '1d6', damageType: 'piercing', properties: ['finesse', 'light'] },
      { name: 'Longbow', type: 'weapon', damage: '1d8', damageType: 'piercing', properties: ['ammunition', 'heavy', 'two-handed'], range: '150/600' },
    ],
    armor: { name: 'Scale Mail', base: 14, maxDex: 2 },
  },
  Rogue: {
    blurb: 'Sneaky, precise, good with locks.',
    abilityOrder: ['dexterity', 'constitution', 'charisma', 'wisdom', 'intelligence', 'strength'],
    weapons: [
      { name: 'Rapier', type: 'weapon', damage: '1d8', damageType: 'piercing', properties: ['finesse'] },
      { name: 'Shortbow', type: 'weapon', damage: '1d6', damageType: 'piercing', properties: ['ammunition', 'two-handed'], range: '80/320' },
    ],
    armor: { name: 'Leather Armor', base: 11, maxDex: null },
  },
  Sorcerer: {
    blurb: 'Born with raw, explosive magic.',
    abilityOrder: ['charisma', 'constitution', 'dexterity', 'wisdom', 'intelligence', 'strength'],
    weapons: [{ name: 'Dagger', type: 'weapon', damage: '1d4', damageType: 'piercing', properties: ['finesse', 'light', 'thrown'] }],
    spells: [
      spell('Fire Bolt', 0, 'Evocation', '120 feet', { damage: '1d10', damageType: 'fire', attack: true }),
      spell('Magic Missile', 1, 'Evocation', '120 feet', { damage: '1d4+1', damageType: 'force' }),
      spell('Burning Hands', 1, 'Evocation', 'Self (15-foot cone)', { damage: '3d6', damageType: 'fire', savingThrow: 'dex' }),
    ],
  },
  Warlock: {
    blurb: 'Made a pact for eldritch power.',
    abilityOrder: ['charisma', 'constitution', 'dexterity', 'wisdom', 'intelligence', 'strength'],
    weapons: [{ name: 'Dagger', type: 'weapon', damage: '1d4', damageType: 'piercing', properties: ['finesse', 'light', 'thrown'] }],
    armor: { name: 'Leather Armor', base: 11, maxDex: null },
    spells: [
      spell('Eldritch Blast', 0, 'Evocation', '120 feet', { damage: '1d10', damageType: 'force', attack: true }),
      spell('Hellish Rebuke', 1, 'Evocation', '60 feet', { damage: '2d10', damageType: 'fire', savingThrow: 'dex' }),
    ],
  },
  Wizard: {
    blurb: 'Fragile, with spells that end fights.',
    abilityOrder: ['intelligence', 'constitution', 'dexterity', 'wisdom', 'charisma', 'strength'],
    weapons: [{ name: 'Quarterstaff', type: 'weapon', damage: '1d6', damageType: 'bludgeoning', properties: ['versatile'] }],
    spells: [
      spell('Fire Bolt', 0, 'Evocation', '120 feet', { damage: '1d10', damageType: 'fire', attack: true }),
      spell('Magic Missile', 1, 'Evocation', '120 feet', { damage: '1d4+1', damageType: 'force' }),
      spell('Sleep', 1, 'Enchantment', '90 feet'),
    ],
  },
};

const ABILITIES: AbilityName[] = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
const SHORT: Record<AbilityName, string> = {
  strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha',
};
const mod = (score: number) => Math.floor((score - 10) / 2);

export const RACE_NAMES = Object.keys(SRD_RACES) as Race[];
export const CLASS_NAMES = Object.keys(SRD_CLASSES) as CharacterClass[];

export function isRace(value: unknown): value is Race {
  return typeof value === 'string' && (RACE_NAMES as string[]).includes(value);
}

export function isCharacterClass(value: unknown): value is CharacterClass {
  return typeof value === 'string' && (CLASS_NAMES as string[]).includes(value);
}

/** Letters (any script), spaces, apostrophes and hyphens; 2 to 24 characters. */
export function cleanCharacterName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/[^\p{L}\p{M} '’-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 24).trim();
  return name.length >= 2 ? name : null;
}

export function cleanBackstory(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const text = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  return text || undefined;
}

/** What the character creator shows: every race and class with a one-line pitch. */
export function characterOptions() {
  return {
    races: RACE_NAMES.map(name => {
      const bonuses = getRaceAbilityBonuses(name);
      return {
        name,
        speed: getRaceSpeed(name),
        bonuses: Object.entries(bonuses)
          .map(([ability, n]) => `+${n} ${SHORT[ability as AbilityName].toUpperCase()}`)
          .join(', '),
      };
    }),
    classes: CLASS_NAMES.map(name => ({
      name,
      blurb: KITS[name].blurb,
      hitDie: SRD_CLASSES[name].hitDie,
      caster: Boolean(KITS[name].spells),
    })),
  };
}

export function buildCharacter(choices: CharacterChoices): Omit<CharacterSheet, 'id' | 'campaignId'> {
  const kit = KITS[choices.class];
  const classData = SRD_CLASSES[choices.class];
  const raceData = SRD_RACES[choices.race];

  // Standard array dealt by class priority, then racial bonuses on top.
  const racial = getRaceAbilityBonuses(choices.race);
  const scores = {} as Record<AbilityName, number>;
  kit.abilityOrder.forEach((ability, i) => {
    scores[ability] = STANDARD_ARRAY[i] + (racial[ability] ?? 0);
  });
  const abilities = {} as Record<AbilityName, { score: number; modifier: number }>;
  for (const ability of ABILITIES) {
    abilities[ability] = { score: scores[ability], modifier: mod(scores[ability]) };
  }
  const dex = abilities.dexterity.modifier;

  let ac = 10 + dex;
  if (kit.armor) {
    ac = kit.armor.base + (kit.armor.maxDex === null ? dex : Math.min(dex, kit.armor.maxDex));
  } else if (kit.unarmoredBonus) {
    ac = 10 + dex + abilities[kit.unarmoredBonus].modifier;
  }
  if (kit.shield) ac += 2;

  const maxHP = Math.max(1, getStartingHP(choices.class, abilities.constitution.modifier));

  const skills: Record<string, number> = {};
  for (const skill of classData.skillChoices.from.slice(0, classData.skillChoices.choose)) {
    const ability = SKILLS[skill as keyof typeof SKILLS]?.ability;
    if (ability) skills[skill] = abilities[ability].modifier + 2;
  }

  const slots = kit.spells ? getSpellSlots(choices.class, 1) : null;
  const spellSlots = slots
    ? Object.fromEntries(Object.entries(slots).map(([level, n]) => [level, { current: n, max: n }]))
    : undefined;

  return {
    name: choices.name,
    race: choices.race,
    class: choices.class,
    level: 1,
    background: 'Adventurer',
    experiencePoints: 0,
    abilities,
    hp: { current: maxHP, max: maxHP, temp: 0 },
    ac,
    speed: getRaceSpeed(choices.race),
    proficiencyBonus: 2,
    skills,
    savingThrows: classData.savingThrowProficiencies.map(a => SHORT[a]),
    proficiencies: {
      armor: classData.armorProficiencies,
      weapons: classData.weaponProficiencies,
      tools: classData.toolProficiencies,
      languages: raceData.languages,
    },
    equipment: {
      weapons: kit.weapons,
      ...(kit.armor ? { armor: { name: kit.armor.name, type: 'armor' as const, ac: kit.armor.base } } : {}),
      ...(kit.shield ? { shield: { name: 'Shield', type: 'armor' as const, acBonus: 2 } } : {}),
      inventory: [
        { name: "Explorer's Pack", type: 'gear', quantity: 1 },
        { name: 'Torch', type: 'gear', quantity: 5 },
      ],
      currency: { gp: 10, sp: 0, cp: 0 },
    },
    hitDice: { current: 1, max: 1 },
    features: classData.features[1] ?? [],
    racialTraits: getRaceTraits(choices.race),
    ...(kit.spells ? { spellsKnown: kit.spells } : {}),
    ...(spellSlots && Object.keys(spellSlots).length > 0 ? { spellSlots } : {}),
    isAI: false,
    backstory: choices.backstory,
  };
}
