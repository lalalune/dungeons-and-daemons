/**
 * E2E Test Helpers — shared utilities for Playwright tests against the D&D VTT.
 * All helpers operate against the real DOM produced by the React components.
 * Tests run against a REAL server with REAL database and REAL LLM APIs. No mocks.
 */

import { type Page, type Locator, expect } from '@playwright/test';

const API_BASE = process.env.API_BASE ?? 'http://localhost:3344';

export const DM_RESPONSE_TIMEOUT = 30_000;
export const WS_PROPAGATION_DELAY = 3_000;

// --- API helpers ---

export interface CampaignSummary { id: string; name: string; status: string; description: string; }
export interface CharacterSummary { id: string; name: string; race: string; class: string; level: number; isAI: boolean; }

export async function getCampaigns(): Promise<CampaignSummary[]> {
  const res = await fetch(`${API_BASE}/api/campaigns`);
  return res.json() as Promise<CampaignSummary[]>;
}

export async function getCharacters(campaignId: string): Promise<CharacterSummary[]> {
  const res = await fetch(`${API_BASE}/api/campaigns/${campaignId}/characters`);
  return res.json() as Promise<CharacterSummary[]>;
}

export async function isServerHealthy(): Promise<boolean> {
  try { const res = await fetch(`${API_BASE}/api/health`); return res.ok; } catch { return false; }
}

// --- Navigation ---

export async function gotoVTT(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('h1').filter({ hasText: 'D&D Virtual Tabletop' })).toBeVisible({ timeout: 10_000 });
}

// --- Join flow ---

export interface JoinResult { campaignName: string; characterName: string; }

export async function joinAsCharacter(page: Page, characterIndex = 0, campaignIndex = 0): Promise<JoinResult> {
  await gotoVTT(page);
  await expect(page.locator('text=Select Campaign')).toBeVisible({ timeout: 10_000 });

  const campaignButtons = page.locator('text=Select Campaign').locator('..').locator('button');
  const campaignBtn = campaignButtons.nth(campaignIndex);
  const campaignName = (await campaignBtn.locator('.font-medium').first().textContent()) ?? '';
  await campaignBtn.click();

  await expect(page.locator('text=Choose Your Character')).toBeVisible({ timeout: 10_000 });
  const charGrid = page.locator('.grid.grid-cols-2 button');
  await expect(charGrid.first()).toBeVisible({ timeout: 5_000 });

  const idx = Math.min(characterIndex, (await charGrid.count()) - 1);
  const charBtn = charGrid.nth(Math.max(0, idx));
  const characterName = (await charBtn.locator('.font-medium').first().textContent()) ?? '';
  await charBtn.click();

  const joinBtn = page.locator('button').filter({ hasText: 'Join as Character' });
  await expect(joinBtn).toBeEnabled({ timeout: 5_000 });
  await joinBtn.click();

  await expect(page.locator('text=Adventure Log').first()).toBeVisible({ timeout: 15_000 });
  return { campaignName, characterName };
}

export async function joinAsSpectator(page: Page, campaignIndex = 0): Promise<void> {
  await gotoVTT(page);
  await expect(page.locator('text=Select Campaign')).toBeVisible({ timeout: 10_000 });
  const campaignButtons = page.locator('text=Select Campaign').locator('..').locator('button');
  await campaignButtons.nth(campaignIndex).click();
  await page.waitForTimeout(1_000);
  const spectateBtn = page.locator('button').filter({ hasText: 'Spectate' });
  await expect(spectateBtn).toBeEnabled({ timeout: 5_000 });
  await spectateBtn.click();
  await expect(page.locator('text=Adventure Log').first()).toBeVisible({ timeout: 15_000 });
}

// --- In-game actions ---

export async function sendMessage(page: Page, message: string): Promise<void> {
  const input = page.locator('input[type="text"]').first();
  await expect(input).toBeVisible({ timeout: 5_000 });
  await input.fill(message);
  await input.press('Enter');
}

export async function clickQuickAction(page: Page, label: string): Promise<void> {
  const btn = page.locator('button').filter({ hasText: label });
  await expect(btn).toBeVisible({ timeout: 5_000 });
  await btn.click();
}

export async function leaveGame(page: Page): Promise<void> {
  await page.locator('button').filter({ hasText: 'Leave' }).click();
  await expect(page.locator('h1').filter({ hasText: 'D&D Virtual Tabletop' })).toBeVisible({ timeout: 10_000 });
}

// --- Adventure log helpers ---

export function logEntries(page: Page): Locator {
  return page.locator('.border-l-4.rounded-r');
}

export function logEntriesBySpeaker(page: Page, speaker: string): Locator {
  return logEntries(page).filter({ has: page.locator('.font-medium', { hasText: speaker }) });
}

export async function countDMEntries(page: Page): Promise<number> {
  return logEntriesBySpeaker(page, 'Dungeon Master').count();
}

export async function waitForNewDMResponse(page: Page, previousCount: number, timeout = DM_RESPONSE_TIMEOUT): Promise<string> {
  await expect(async () => {
    const count = await countDMEntries(page);
    expect(count).toBeGreaterThan(previousCount);
  }).toPass({ timeout });
  const newest = logEntriesBySpeaker(page, 'Dungeon Master').last();
  return (await newest.locator('.whitespace-pre-wrap').textContent()) ?? '';
}

export async function isDMTyping(page: Page): Promise<boolean> {
  return page.locator('text=is composing a response').isVisible();
}

// --- Assertions ---

export async function assertConnected(page: Page): Promise<void> {
  await expect(page.locator('text=Connected').first()).toBeVisible({ timeout: 10_000 });
}

export async function assertCharacterStats(page: Page): Promise<void> {
  await expect(page.locator('text=HP').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('text=AC').first()).toBeVisible({ timeout: 10_000 });
}

export async function assertActionBarReady(page: Page): Promise<void> {
  const input = page.locator('input[type="text"]').first();
  await expect(input).toBeVisible({ timeout: 5_000 });
  await expect(input).toBeEnabled();
}

export async function assertQuickActionVisible(page: Page, label: string): Promise<void> {
  await expect(page.locator('button').filter({ hasText: label })).toBeVisible({ timeout: 5_000 });
}
