/**
 * Global setup for UI smoke tests.
 * 
 * Reads the room key from the file written by ensure-ui-test-room.sh
 * and makes it available to tests via environment variable.
 * 
 * If the room key file doesn't exist, this will fail loudly.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOM_KEY_FILE = '/tmp/pi-matrix-agent-ui-test-roomkey';

export default async function globalSetup() {
  console.log('[Global Setup] Reading room key from', ROOM_KEY_FILE);
  
  try {
    const roomKey = readFileSync(ROOM_KEY_FILE, 'utf-8').trim();
    
    if (!roomKey) {
      throw new Error('Room key file is empty');
    }
    
    console.log(`[Global Setup] Room key: ${roomKey}`);
    
    // Export for tests to use
    process.env.UI_TEST_ROOM_KEY = roomKey;
    
    return roomKey;
  } catch (error: any) {
    console.error('[Global Setup] FAILED to read room key');
    console.error('');
    console.error('To set up the test room:');
    console.error('');
    console.error('1. Set TEST_MATRIX_ROOM_ID to your test room:');
    console.error('   export TEST_MATRIX_ROOM_ID="!roomid:example.com"');
    console.error('');
    console.error('2. Send a message to that room (e.g., "test")');
    console.error('');
    console.error('3. Run the setup script:');
    console.error('   ./scripts/ensure-ui-test-room.sh');
    console.error('');
    console.error('Or run tests with automatic setup:');
    console.error('   TEST_MATRIX_ROOM_ID="!roomid:example.com" npm run smoke:ui');
    console.error('');
    
    // Fail loudly - do not silently skip
    throw new Error(`Room key not found at ${ROOM_KEY_FILE}. Run ./scripts/ensure-ui-test-room.sh first.`);
  }
}
