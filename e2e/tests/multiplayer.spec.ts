/**
 * E2E Tests — Multi-Player (Smoke)
 * Quick smoke tests for multiplayer. For comprehensive coverage see multiplayer-session.spec.ts.
 */

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import {
  joinAsCharacter,
  sendMessage,
  logEntriesBySpeaker,
  WS_PROPAGATION_DELAY,
} from './helpers';

let context1: BrowserContext;
let context2: BrowserContext;
let page1: Page;
let page2: Page;

test.describe('Multi-Player (Smoke)', () => {
  test.beforeEach(async ({ browser }) => {
    context1 = await browser.newContext();
    context2 = await browser.newContext();
    page1 = await context1.newPage();
    page2 = await context2.newPage();
  });

  test.afterEach(async () => {
    await context1?.close();
    await context2?.close();
  });

  test('two players can both join and see the game UI', async () => {
    await Promise.all([
      joinAsCharacter(page1, 0),
      joinAsCharacter(page2, 2),
    ]);
    await expect(page1.locator('text=Adventure Log').first()).toBeVisible({ timeout: 15_000 });
    await expect(page2.locator('text=Adventure Log').first()).toBeVisible({ timeout: 15_000 });
  });

  test('player 1 message is broadcast to player 2', async () => {
    await Promise.all([
      joinAsCharacter(page1, 0),
      joinAsCharacter(page2, 2),
    ]);
    await page1.waitForTimeout(WS_PROPAGATION_DELAY);
    await sendMessage(page1, 'The fighter raises her sword and shouts a battle cry!');
    await expect(
      page2.locator('text=/battle cry|fighter|sword/i').first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test('both players receive DM narration', async () => {
    await Promise.all([
      joinAsCharacter(page1, 0),
      joinAsCharacter(page2, 2),
    ]);
    await expect(logEntriesBySpeaker(page1, 'Dungeon Master').first()).toBeVisible({ timeout: 15_000 });
    await expect(logEntriesBySpeaker(page2, 'Dungeon Master').first()).toBeVisible({ timeout: 15_000 });
  });
});
