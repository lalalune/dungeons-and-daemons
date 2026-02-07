/**
 * E2E Tests — Gameplay Basics
 * Individual feature tests for messages, DM responses, quick actions, character panel, adventure log.
 * For full journeys see solo-player-journey.spec.ts and multiplayer-session.spec.ts.
 * All tests use REAL APIs, REAL LLM — no mocks.
 */

import { test, expect } from '@playwright/test';
import {
  joinAsCharacter,
  sendMessage,
  clickQuickAction,
  logEntries,
  logEntriesBySpeaker,
  countDMEntries,
  waitForNewDMResponse,
  assertActionBarReady,
  assertQuickActionVisible,
  assertCharacterStats,
} from './helpers';

test.describe('Gameplay — Messages & DM Responses', () => {
  test('sending a message shows it in the adventure log', async ({ page }) => {
    await joinAsCharacter(page);
    await page.waitForTimeout(3_000);
    await sendMessage(page, 'I look around the village square.');
    await expect(page.locator('text=I look around the village square').first()).toBeVisible({ timeout: 5_000 });
  });

  test('DM responds to player message', async ({ page }) => {
    await joinAsCharacter(page);
    await page.waitForTimeout(3_000);
    const dmCountBefore = await countDMEntries(page);
    await sendMessage(page, 'I approach the notice board and read the posted notices.');
    const response = await waitForNewDMResponse(page, dmCountBefore);
    expect(response.length).toBeGreaterThan(10);
  });

  test('multiple messages maintain conversation flow', async ({ page }) => {
    await joinAsCharacter(page);
    await page.waitForTimeout(3_000);
    const dmCount1 = await countDMEntries(page);
    await sendMessage(page, 'Who is the mayor of this village?');
    await waitForNewDMResponse(page, dmCount1);
    const dmCount2 = await countDMEntries(page);
    await sendMessage(page, 'Where can I find information about the goblin problem?');
    await waitForNewDMResponse(page, dmCount2);
    await expect(page.locator('text=mayor').first()).toBeVisible();
    await expect(page.locator('text=goblin').first()).toBeVisible();
  });
});

test.describe('Gameplay — Quick Actions', () => {
  test('exploration action buttons are visible after joining', async ({ page }) => {
    await joinAsCharacter(page);
    await page.waitForTimeout(2_000);
    await assertActionBarReady(page);
    await assertQuickActionVisible(page, 'Look Around');
    await assertQuickActionVisible(page, 'Investigate');
    await assertQuickActionVisible(page, 'Short Rest');
    await assertQuickActionVisible(page, 'Long Rest');
  });

  test('"Look Around" explore action works', async ({ page }) => {
    await joinAsCharacter(page);
    await page.waitForTimeout(3_000);
    const dmCountBefore = await countDMEntries(page);
    await clickQuickAction(page, 'Look Around');
    await expect(page.locator('text=looks around carefully').first()).toBeVisible({ timeout: 5_000 });
    await waitForNewDMResponse(page, dmCountBefore);
  });

  test('"Investigate" action works', async ({ page }) => {
    await joinAsCharacter(page);
    await page.waitForTimeout(3_000);
    const dmCountBefore = await countDMEntries(page);
    await clickQuickAction(page, 'Investigate');
    await expect(page.locator('text=investigates the area').first()).toBeVisible({ timeout: 5_000 });
    await waitForNewDMResponse(page, dmCountBefore);
  });
});

test.describe('Gameplay — Character Panel', () => {
  test('character stats are displayed', async ({ page }) => {
    await joinAsCharacter(page);
    await page.waitForTimeout(3_000);
    await assertCharacterStats(page);
  });

  test('character class/race info is visible', async ({ page }) => {
    await joinAsCharacter(page);
    await page.waitForTimeout(3_000);
    await expect(page.locator('text=/Fighter|Wizard|Cleric|Rogue/i').first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Gameplay — Adventure Log', () => {
  test('adventure log panel is visible after joining', async ({ page }) => {
    await joinAsCharacter(page);
    await expect(page.locator('text=Adventure Log').first()).toBeVisible();
  });

  test('system messages appear on connection', async ({ page }) => {
    await joinAsCharacter(page);
    await page.waitForTimeout(2_000);
    await expect(page.locator('text=Connected to the game server').first()).toBeVisible({ timeout: 5_000 });
  });

  test('DM narration entries have speaker attribution', async ({ page }) => {
    await joinAsCharacter(page);
    await page.waitForTimeout(5_000);
    const dmEntry = logEntriesBySpeaker(page, 'Dungeon Master').first();
    await expect(dmEntry).toBeVisible({ timeout: 15_000 });
  });

  test('log auto-scrolls to latest entry', async ({ page }) => {
    await joinAsCharacter(page);
    await page.waitForTimeout(3_000);
    for (let i = 0; i < 5; i++) {
      await sendMessage(page, `Auto-scroll test message ${i + 1}`);
      await page.waitForTimeout(1_500);
    }
    await expect(page.locator('text=Auto-scroll test message 5').first()).toBeVisible({ timeout: 10_000 });
  });
});
