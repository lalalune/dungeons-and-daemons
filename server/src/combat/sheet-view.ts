/**
 * Everything the character sheet screen shows, worked out from the stored sheet:
 * ability scores, saving throws, all eighteen skills, proficiencies, features
 * and spells.
 */

import type { AbilityName, CharacterSheet } from '../types';
import { SKILLS } from '../types';
import type { SkillName } from '../types';
import { SRD_CLASSES } from '../data/srd-classes';
import { getRaceTraits } from '../data/srd-races';
import type { Race } from '../types';
import { resolveCombatStats } from './stat-resolver';
import { spellText } from '../data/dungeoneer';

const ABILITIES: AbilityName[] = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
const SHORT: Record<AbilityName, string> = {
  strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha',
};

export interface SheetView {
  background?: string;
  alignment?: string;
  experience: number;
  proficiencyBonus: number;
  initiative: number;
  passivePerception: number;
  hitDice: string;
  abilities: { key: string; name: string; score: number; modifier: number }[];
  savingThrows: { key: string; name: string; modifier: number; proficient: boolean }[];
  skills: { name: string; ability: string; modifier: number; proficient: boolean }[];
  proficiencies: { armor: string[]; weapons: string[]; tools: string[]; languages: string[] };
  features: string[];
  racialTraits: string[];
  spellcasting: { ability: string; saveDC: number; attackBonus: number } | null;
  spells: {
    name: string; level: number; school: string; range: string; detail: string;
    description?: string; castingTime?: string; duration?: string; components?: string;
  }[];
  backstory?: string;
}

function abilityStats(sheet: CharacterSheet, ability: AbilityName): { score: number; modifier: number } {
  const raw = (sheet.abilities as unknown as Record<string, { score: number; modifier: number } | number>)[ability];
  if (typeof raw === 'number') return { score: raw, modifier: Math.floor((raw - 10) / 2) };
  if (raw && typeof raw.score === 'number') return { score: raw.score, modifier: raw.modifier ?? Math.floor((raw.score - 10) / 2) };
  return { score: 10, modifier: 0 };
}

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function buildSheetView(sheet: CharacterSheet): SheetView {
  const prof = sheet.proficiencyBonus ?? 2;
  const stats = Object.fromEntries(ABILITIES.map(a => [a, abilityStats(sheet, a)])) as Record<AbilityName, { score: number; modifier: number }>;

  // Saving throw proficiencies are stored as short codes or full names.
  const saveList = [...(sheet.savingThrows ?? []), ...((sheet.proficiencies?.savingThrows ?? []) as string[])]
    .map(s => String(s).toLowerCase());
  const savingThrows = ABILITIES.map(a => {
    const proficient = saveList.includes(SHORT[a]) || saveList.includes(a);
    return { key: SHORT[a], name: title(a), modifier: stats[a].modifier + (proficient ? prof : 0), proficient };
  });

  // Skills the sheet lists are trained (their bonus is stored); the rest use the bare ability.
  const trained = new Map(Object.entries(sheet.skills ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const skills = (Object.keys(SKILLS) as SkillName[]).map(name => {
    const def = SKILLS[name];
    const stored = trained.get(name.toLowerCase());
    return {
      name: def.displayName,
      ability: SHORT[def.ability],
      modifier: typeof stored === 'number' ? stored : stats[def.ability].modifier,
      proficient: typeof stored === 'number',
    };
  });
  const perception = skills.find(s => s.name === 'Perception')?.modifier ?? stats.wisdom.modifier;

  const hitDie = sheet.hitDice?.type ?? SRD_CLASSES[sheet.class as keyof typeof SRD_CLASSES]?.hitDie ?? 'd8';
  const dice = sheet.hitDice ?? { current: sheet.level, max: sheet.level };

  // Sheets written before features were recorded fall back to the rulebook's list.
  const byLevel = SRD_CLASSES[sheet.class as keyof typeof SRD_CLASSES]?.features ?? {};
  const classFeatures = Object.entries(byLevel)
    .filter(([level]) => Number(level) <= sheet.level)
    .flatMap(([, list]) => list);

  const spells = [...(sheet.cantrips ?? []), ...(sheet.spellsKnown ?? [])];
  const combat = spells.length > 0 ? resolveCombatStats(sheet) : null;
  const castingAbility = Object.entries(stats)
    .find(([, s]) => combat && s.modifier + prof === combat.spellAttackBonus)?.[0];

  return {
    background: sheet.background,
    alignment: sheet.alignment ? String(sheet.alignment) : undefined,
    experience: sheet.experiencePoints ?? 0,
    proficiencyBonus: prof,
    initiative: sheet.initiative ?? stats.dexterity.modifier,
    passivePerception: 10 + perception,
    hitDice: `${dice.current}/${dice.max} ${hitDie}`,
    abilities: ABILITIES.map(a => ({ key: SHORT[a], name: title(a), ...stats[a] })),
    savingThrows,
    skills,
    proficiencies: {
      armor: sheet.proficiencies?.armor ?? [],
      weapons: sheet.proficiencies?.weapons ?? [],
      tools: sheet.proficiencies?.tools ?? [],
      languages: sheet.proficiencies?.languages ?? [],
    },
    features: sheet.features?.length ? sheet.features : classFeatures,
    racialTraits: sheet.racialTraits?.length ? sheet.racialTraits : getRaceTraits(sheet.race as Race),
    spellcasting: combat
      ? { ability: title(String(sheet.spellcastingAbility ?? castingAbility ?? 'spellcasting')), saveDC: combat.spellSaveDC, attackBonus: combat.spellAttackBonus }
      : null,
    spells: spells
      .map(s => ({
        ...(spellText(s.name) ?? {}),
        name: s.name,
        level: s.level,
        school: String(s.school),
        range: s.range,
        detail: [
          s.damage ? `${s.damage}${s.damageType ? ` ${s.damageType}` : ''}` : '',
          s.healing ? `heals ${s.healing}` : '',
          s.attack ? 'spell attack' : '',
          s.savingThrow ? `${String(s.savingThrow).toUpperCase()} save` : '',
        ].filter(Boolean).join(' · '),
      }))
      .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)),
    backstory: sheet.backstory ?? sheet.personality?.backstory,
  };
}
