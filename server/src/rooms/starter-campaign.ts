/**
 * Creates a fresh copy of the starter adventure in the database.
 * Every room gets its own campaign so tables never share world state.
 */

import {
  campaignRepository,
  characterRepository,
  locationRepository,
  worldRepository,
} from '../persistence';
import {
  starterCampaign,
  starterLocations,
  starterNPCs,
  starterQuests,
  starterParty,
} from '../content';
import type { CharacterSheet } from '../types';
import { DEFAULT_ADVENTURE_ID, type Adventure } from '../content/adventures';

const slug = (name: string) => name.toLowerCase().replace(/\s+/g, '-');

/**
 * A campaign for an adventure that exists only as a brief: one starting
 * location and the ready-made party. The Dungeon Master supplies the rest.
 */
async function createBriefCampaign(adventure: Adventure): Promise<string> {
  const campaign = await campaignRepository.create({
    name: adventure.title,
    description: adventure.summary,
    dmAgentId: crypto.randomUUID(),
  });
  const campaignId = campaign.id;
  if (!campaignId) throw new Error('Campaign was created without an id');

  const start = await locationRepository.create({
    name: adventure.startLocation.name,
    type: 'town',
    description: adventure.startLocation.description,
    campaignId,
    parentLocationId: undefined,
    tags: [],
    npcs: [],
    pointsOfInterest: [],
    availableServices: [],
    dangerLevel: 1,
  });
  if (start.id) await campaignRepository.update(campaignId, { currentLocationId: start.id });

  for (const member of starterParty) {
    await characterRepository.create({ campaignId, sheet: member as CharacterSheet });
  }
  return campaignId;
}

export async function createStarterCampaign(adventure?: Adventure): Promise<string> {
  if (adventure && adventure.id !== DEFAULT_ADVENTURE_ID) return createBriefCampaign(adventure);

  const campaign = await campaignRepository.create({
    name: starterCampaign.name,
    description: starterCampaign.description,
    dmAgentId: crypto.randomUUID(),
  });
  const campaignId = campaign.id;
  if (!campaignId) throw new Error('Campaign was created without an id');

  const locationIds = new Map<string, string>();
  for (const loc of starterLocations) {
    const created = await locationRepository.create({
      name: loc.name,
      type: loc.type,
      description: loc.description,
      campaignId,
      parentLocationId: undefined,
      tags: loc.tags,
      npcs: loc.npcs,
      pointsOfInterest: loc.pointsOfInterest,
      availableServices: loc.availableServices,
      dangerLevel: loc.dangerLevel,
    });
    if (created.id) locationIds.set(slug(loc.name), created.id);
  }

  const startId = locationIds.get(starterCampaign.startingLocationId ?? '') ?? locationIds.values().next().value;
  if (startId) {
    await campaignRepository.update(campaignId, { currentLocationId: startId });
  }

  for (const npc of starterNPCs) {
    const ref = npc.currentLocationId;
    const locationId = ref
      ? locationIds.get(ref) ?? locationIds.get(`the-${ref}`)
      : undefined;
    await locationRepository.createNPC({
      campaignId,
      name: npc.name,
      type: npc.type,
      race: npc.race,
      occupation: npc.occupation,
      personality: npc.personality,
      motivation: npc.motivation,
      secrets: npc.secrets,
      locationId,
      isHostile: npc.isHostile,
    });
  }

  for (const quest of starterQuests) {
    await worldRepository.createQuest({
      campaignId,
      name: quest.name,
      description: quest.description,
      type: quest.type,
      giver: quest.giver,
      locationId: locationIds.get('the-goblin-den'),
      objectives: quest.objectives.map(o => ({ description: o.description })),
      rewards: quest.rewards,
      importance: quest.importance,
    });
  }

  for (const member of starterParty) {
    await characterRepository.create({
      campaignId,
      sheet: member as CharacterSheet,
    });
  }

  return campaignId;
}
