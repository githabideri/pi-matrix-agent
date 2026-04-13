import { test, expect } from '@playwright/test';

/**
 * UI Smoke Tests for pi-matrix-agent Web UI
 *
 * These tests verify the basic functionality of the operator dashboard:
 * - Page loads without getting stuck
 * - All panels are visible
 * - Control endpoints respond quickly (not blocking)
 *
 * Prerequisites:
 * - Control server running on http://127.0.0.1:9000
 * - Test room set up via TEST_MATRIX_ROOM_ID
 *
 * IMPORTANT: These tests do NOT skip on missing preconditions.
 * They either pass or fail - no silent skips.
 * 
 * Setup:
 *   export TEST_MATRIX_ROOM_ID='!roomid:example.com'
 *   ./scripts/ensure-ui-test-room.sh
 *   npm run smoke:ui
 */

const BASE_URL = 'http://127.0.0.1:9000';

// Test fixtures
test.describe('Web UI Smoke Tests', () => {
  // Room key is set by global-setup.ts from ensure-ui-test-room.sh
  const roomKey = process.env.UI_TEST_ROOM_KEY;

  test.beforeAll(() => {
    if (!roomKey) {
      throw new Error(
        'UI_TEST_ROOM_KEY not set. Run ./scripts/ensure-ui-test-room.sh first.' +
        '\n\nSet TEST_MATRIX_ROOM_ID, send a message to that room, then run:' +
        '\n  ./scripts/ensure-ui-test-room.sh'
      );
    }
    console.log(`[Tests] Using room key: ${roomKey}`);
  });

  /**
   * IDLE PATH TESTS - Test UI when no inference is running
   */
  test.describe('Idle Path', () => {
    test('should load room page without waiting state', async ({ page }) => {
      // Set timeout - page must load within 5 seconds
      await page.goto(`${BASE_URL}/app/room/${roomKey}`, {
        waitUntil: 'networkidle',
        timeout: 5000,
      });
      
      // Should NOT show "waiting" state
      const waitingText = await page.$('text=Waiting');
      expect(waitingText).toBeNull();
      
      // Page title should be set
      const title = await page.title();
      expect(title).toContain('Room:');
    });

    test('should show status panel', async ({ page }) => {
      await page.goto(`${BASE_URL}/app/room/${roomKey}`);
      
      // Status panel should be visible
      const statusPanel = await page.$('.status-panel');
      expect(statusPanel).not.isNull();
      
      // Should have a heading
      const statusHeading = await statusPanel?.$('h2');
      expect(await statusHeading?.innerText()).toContain('Status');
    });

    test('should show manifest panel', async ({ page }) => {
      await page.goto(`${BASE_URL}/app/room/${roomKey}`);
      
      // Manifest panel should be visible
      const manifestPanel = await page.$('.manifest-panel');
      expect(manifestPanel).not.isNull();
      
      // Should have a heading
      const manifestHeading = await manifestPanel?.$('h2');
      expect(await manifestHeading?.innerText()).toContain('Context');
    });

    test('should show transcript panel', async ({ page }) => {
      await page.goto(`${BASE_URL}/app/room/${roomKey}`);
      
      // Transcript panel should be visible
      const transcriptPanel = await page.$('.transcript-panel');
      expect(transcriptPanel).not.isNull();
      
      // Should have a heading
      const transcriptHeading = await transcriptPanel?.$('h2');
      expect(await transcriptHeading?.innerText()).toContain('Transcript');
    });

    test('should show archive panel', async ({ page }) => {
      await page.goto(`${BASE_URL}/app/room/${roomKey}`);
      
      // Archive panel should be visible
      const archivePanel = await page.$('.archive-panel');
      expect(archivePanel).not.isNull();
      
      // Should have a heading
      const archiveHeading = await archivePanel?.$('h2');
      expect(await archiveHeading?.innerText()).toContain('Archive');
    });

    test('should render room key in page', async ({ page }) => {
      await page.goto(`${BASE_URL}/app/room/${roomKey}`);
      
      // Check that room key appears in title
      const title = await page.title();
      expect(title).toContain(roomKey);
      
      // Check that room key is accessible via window.ROOM_KEY
      const pageRoomKey = await page.evaluate(() => window.ROOM_KEY);
      expect(pageRoomKey).toBe(roomKey);
    });

    /**
     * REGRESSION TESTS - These tests would have caught the current bug where
     * load() was never called and the page showed empty shell with "Unknown" status
     */
    test('should populate status panel with actual room data', async ({ page }) => {
      await page.goto(`${BASE_URL}/app/room/${roomKey}`);
      
      // Wait for data to load (with timeout)
      await page.waitForTimeout(2000);
      
      // Status text should NOT be stuck on "Unknown" (the initial shell state)
      const statusText = await page.$('.status-text');
      const statusContent = await statusText?.innerText();
      
      // Should be one of the valid states, not "Unknown"
      expect(statusContent).not.toBe('Unknown');
      expect(['Idle', 'Processing', 'Streaming', 'Not Live'].includes(statusContent || '')).toBeTruthy();
    });

    test('should show room ID in status panel fields', async ({ page }) => {
      await page.goto(`${BASE_URL}/app/room/${roomKey}`);
      
      // Wait for data to load
      await page.waitForTimeout(2000);
      
      // The status fields area should contain actual room data
      const statusFields = await page.$('.status-fields');
      const fieldsContent = await statusFields?.innerText();
      
      // Should contain "Room ID" label and some actual content
      expect(fieldsContent).toContain('Room ID');
      // Should NOT be empty or just show error message
      expect(fieldsContent?.length).toBeGreaterThan(30);
    });

    test('should load data into at least one real panel', async ({ page }) => {
      await page.goto(`${BASE_URL}/app/room/${roomKey}`);
      
      // Wait for data to load
      await page.waitForTimeout(2000);
      
      // Check that the page has fetched backend data by verifying:
      // 1. Status panel has real content (not just headings)
      const statusPanel = await page.$('.status-panel');
      const statusContent = await statusPanel?.innerText();
      
      // Should contain more than just the heading "Live Status"
      expect(statusContent?.length).toBeGreaterThan(30);
      
      // 2. Status should not be stuck on initial shell state
      expect(statusContent).not.toContain('Unknown');
    });

    test('should have fetched backend data (transcript panel populated)', async ({ page }) => {
      await page.goto(`${BASE_URL}/app/room/${roomKey}`);
      
      // Wait for data to load
      await page.waitForTimeout(2000);
      
      // The transcript panel should show either:
      // - Actual transcript content, OR
      // - A loaded-state indicator (even if empty)
      const transcriptPanel = await page.$('.transcript-panel');
      const transcriptContent = await transcriptPanel?.innerText();
      
      // Should have more than just the "Transcript" heading
      expect(transcriptContent?.length).toBeGreaterThan(15);
      
      // Should not be completely empty
      expect(transcriptContent).toBeTruthy();
    });
  });

  /**
   * BUSY PATH TESTS - Test UI while inference is running
   * These are the critical tests that catch the hanging bug
   */
  test.describe('Busy Path', () => {
    test('control endpoint responds quickly', async ({ request }) => {
      const startTime = Date.now();
      
      // Test that endpoint responds within 2 seconds
      const response = await request.get(`${BASE_URL}/api/live/rooms/${roomKey}`, {
        timeout: 5000,  // Fail if takes longer than 5s
      });
      
      const elapsed = Date.now() - startTime;
      console.log(`Control endpoint responded in ${elapsed}ms`);
      
      // Should respond within 2 seconds
      expect(elapsed).toBeLessThan(2000);
      expect(response.ok()).toBeTruthy();
    });

    test('context endpoint responds quickly', async ({ request }) => {
      const startTime = Date.now();
      
      const response = await request.get(`${BASE_URL}/api/live/rooms/${roomKey}/context`, {
        timeout: 5000,
      });
      
      const elapsed = Date.now() - startTime;
      console.log(`Context endpoint responded in ${elapsed}ms`);
      expect(elapsed).toBeLessThan(2000);
      expect(response.ok()).toBeTruthy();
    });

    test('Web UI page loads without hanging', async ({ page }) => {
      // Page must load within 5 seconds
      await page.goto(`${BASE_URL}/app/room/${roomKey}`, {
        waitUntil: 'networkidle',
        timeout: 5000,
      });
      
      // Should NOT show "waiting" state
      const waitingText = await page.$('text=Waiting');
      expect(waitingText).toBeNull();
      
      // All panels should be visible
      const statusPanel = await page.$('.status-panel');
      expect(statusPanel).not.isNull();
    });

    /**
     * REGRESSION TEST - Verifies that the preview page actually fetches backend data
     * This would have failed before the load() fix was applied
     */
    test('preview page fetches backend data on load', async ({ page }) => {
      // Track if any network requests were made to the API
      let apiRequestMade = false;
      
      page.on('request', (request) => {
        if (request.url().includes('/api/')) {
          apiRequestMade = true;
        }
      });
      
      await page.goto(`${BASE_URL}/app/room/${roomKey}`);
      
      // Wait for data to load
      await page.waitForTimeout(2000);
      
      // Verify that API requests were made
      expect(apiRequestMade).toBeTruthy('Preview page should make API requests to fetch data');
      
      // Verify status panel was populated with real data
      const statusText = await page.$('.status-text');
      const statusContent = await statusText?.innerText();
      
      // Should not be stuck on "Unknown" (initial shell state)
      expect(statusContent).not.toBe('Unknown');
    });
  });

  test('should handle non-existent room gracefully', async ({ page }) => {
    await page.goto(`${BASE_URL}/app/room/non-existent-room-xyz`);
    
    // Page should load (not crash)
    await page.waitForLoadState('networkidle');
    
    // At minimum, page should load without crashing
    const title = await page.title();
    expect(title).toBeTruthy();
  });
});
