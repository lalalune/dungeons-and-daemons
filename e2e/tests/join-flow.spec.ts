/**
 * E2E Tests — Join Flow
 * Page load, campaign/character selection, joining, opening narration, spectator mode.
 * All tests use REAL APIs, REAL database, REAL LLM — no mocks.
 */

import { test, expect } from '@playwright/test';
import {
  gotoVTT,
  joinAsCharacter,
  joinAsSpectator,
  logEntriesBySpeaker,
  assertConnected,
  assertCharacterStats,
  getCampaigns,
  getCharacters,
  isServerHealthy,
} from './helpers';

test.describe('Join Flow', () => {
  test('server is healthy and reachable', async () => {
    expect(await isServerHealthy()).toBe(true);
  });

  test('page loads with VTT title visible', async ({ page }) => {
    await gotoVTT(page);
    await expect(page.locator('h1').filter({ hasText: 'D&D Virtual Tabletop' })).toBeVisible();
  });

  test('campaigns are fetched from the API', async () => {
    const campaigns = await getCampaigns();
    expect(campaigns.length).toBeGreaterThanOrEqual(1);
    expect(campaigns.find(c => c.name.includes('Goblin Den'))).toBeTruthy();
  });

  test('characters are fetched for the campaign', async () => {
    const campaigns = await getCampaigns();
    const characters = await getCharacters(campaigns[0].id);
    expect(characters.length).toBeGreaterThanOrEqual(1);
    expect(characters.some(c => /Fighter|Wizard|Cleric|Rogue/i.test(c.class))).toBe(true);
  });

  test('campaigns are displayed in the UI', async ({ page }) => {
    await gotoVTT(page);
    await expect(page.locator('text=Goblin Den').first()).toBeVisible({ timeout: 10_000 });
  });

  test('selecting a campaign shows characters', async ({ page }) => {
    await gotoVTT(page);
    await page.locator('text=Goblin Den').first().click();
    await expect(page.locator('text=Choose Your Character')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=/Fighter|Wizard|Cleric|Rogue/i').first()).toBeVisible({ timeout: 10_000 });
  });

  test('joining as a character loads the game UI', async ({ page }) => {
    const { characterName } = await joinAsCharacter(page);
    expect(characterName).toBeTruthy();
    await assertConnected(page);
    await expect(page.locator('text=Adventure Log').first()).toBeVisible();
  });

  test('opening narration appears after joining', async ({ page }) => {
    await joinAsCharacter(page);
    const dmEntry = logEntriesBySpeaker(page, 'Dungeon Master').first();
    await expect(dmEntry).toBeVisible({ timeout: 15_000 });
    const text = await dmEntry.locator('.whitespace-pre-wrap').textContent();
    expect(text!.length).toBeGreaterThan(50);
  });

  test('character info is displayed after joining', async ({ page }) => {
    await joinAsCharacter(page);
    await assertCharacterStats(page);
  });

  test('spectator mode works', async ({ page }) => {
    await joinAsSpectator(page);
    await expect(page.locator('text=Adventure Log').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('text=/spectating/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('connection status indicator shows green when connected', async ({ page }) => {
    await gotoVTT(page);
    await expect(page.locator('text=Connected to server').first()).toBeVisible({ timeout: 10_000 });
  });
});
