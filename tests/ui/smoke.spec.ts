import { test, expect, type Page } from '@playwright/test';

/**
 * UI Smoke Tests for pi-matrix-agent Web UI
 *
 * These tests verify the basic functionality of the operator dashboard:
 * - Page loads without getting stuck
 * - All panels are visible
 * - Basic rendering works
 *
 * Prerequisites:
 * - Control server running on http://127.0.0.1:9000
 * - A room with a session exists (create by sending Matrix message)
 */

// Test fixtures
test.describe('Web UI Smoke Tests', () => {
  let roomKey: string;

  /**
   * Get a valid room key from live rooms or archived rooms.
   * Returns undefined if no rooms exist (test will be skipped).
   */
  async function getRoomKey(page: Page): Promise<string | undefined> {
    // Try to get a live room
    try {
      const response = await page.request.get('http://127.0.0.1:9000/api/live/rooms');
      const rooms = await response.json();
      if (rooms && rooms.length > 0) {
        return rooms[0].roomKey;
      }
    } catch {
      // Fall through to archive check
    }

    // No live rooms - check if test server provides a mock room
    // This allows tests to run without real Matrix sessions
    if (process.env.PLAYWRIGHT_MOCK_ROOM) {
      return process.env.PLAYWRIGHT_MOCK_ROOM;
    }

    return undefined;
  }

  test('should have a room to test', async ({ page }) => {
    roomKey = await getRoomKey(page);
    
    if (!roomKey) {
      test.skip(true, 'No room available for testing. Send a Matrix message first or set PLAYWRIGHT_MOCK_ROOM');
    }
    
    console.log(`Using room key: ${roomKey}`);
  });

  test('should load room page without waiting state', async ({ page }) => {
    if (!roomKey) {
      test.skip();
    }

    const url = `/app/room/${roomKey}`;
    await page.goto(url);

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Check that page title is set (not stuck on waiting)
    const title = await page.title();
    expect(title).toContain('Room:');

    // Check that we're not stuck on "waiting for..." message
    const waitingText = page.locator('text=waiting for');
    await expect(waitingText).not.toBeVisible({ timeout: 3000 });
  });

  test('should show status panel', async ({ page }) => {
    if (!roomKey) {
      test.skip();
    }

    const url = `/app/room/${roomKey}`;
    await page.goto(url);

    // Status panel should be visible
    const statusPanel = page.locator('.status-panel');
    await expect(statusPanel).toBeVisible();

    // Should have a heading
    const statusHeading = statusPanel.locator('h2');
    await expect(statusHeading).toContainText('Status');
  });

  test('should show manifest panel', async ({ page }) => {
    if (!roomKey) {
      test.skip();
    }

    const url = `/app/room/${roomKey}`;
    await page.goto(url);

    // Manifest panel should be visible
    const manifestPanel = page.locator('.manifest-panel');
    await expect(manifestPanel).toBeVisible();

    // Should have a heading
    const manifestHeading = manifestPanel.locator('h2');
    await expect(manifestHeading).toContainText('Context');
  });

  test('should show transcript panel', async ({ page }) => {
    if (!roomKey) {
      test.skip();
    }

    const url = `/app/room/${roomKey}`;
    await page.goto(url);

    // Transcript panel should be visible
    const transcriptPanel = page.locator('.transcript-panel');
    await expect(transcriptPanel).toBeVisible();

    // Should have a heading
    const transcriptHeading = transcriptPanel.locator('h2');
    await expect(transcriptHeading).toContainText('Transcript');
  });

  test('should show archive panel', async ({ page }) => {
    if (!roomKey) {
      test.skip();
    }

    const url = `/app/room/${roomKey}`;
    await page.goto(url);

    // Archive panel should be visible
    const archivePanel = page.locator('.archive-panel');
    await expect(archivePanel).toBeVisible();

    // Should have a heading
    const archiveHeading = archivePanel.locator('h2');
    await expect(archiveHeading).toContainText('Archive');
  });

  test('should render room key in page', async ({ page }) => {
    if (!roomKey) {
      test.skip();
    }

    const url = `/app/room/${roomKey}`;
    await page.goto(url);

    // Check that room key is accessible via window.ROOM_KEY
    const pageRoomKey = await page.evaluate(() => window.ROOM_KEY);
    expect(pageRoomKey).toBe(roomKey);
  });

  test('should handle non-existent room gracefully', async ({ page }) => {
    const url = '/app/room/non-existent-room-xyz';
    await page.goto(url);

    // Should show some indication that room doesn't exist or is empty
    // The exact behavior depends on how the app handles missing rooms
    await page.waitForLoadState('networkidle');

    // At minimum, page should load without crashing
    const title = await page.title();
    expect(title).toBeTruthy();
  });
});
