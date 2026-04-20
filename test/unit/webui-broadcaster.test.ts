/**
 * WebUI Broadcaster Tests
 * Tests for the pub-sub mechanism used for room-specific events.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { broadcasterManager } from "../../src/webui-broadcaster.js";
import type { WebUIEvent } from "../../src/webui-types.js";

describe("WebUIBroadcaster", () => {
  let roomKey: string;

  beforeEach(() => {
    roomKey = "test-room-123";
    // Clean up any existing broadcaster for this room
    broadcasterManager.remove(roomKey);
  });

  afterEach(() => {
    broadcasterManager.remove(roomKey);
  });

  describe("get()", () => {
    it("returns a broadcaster for a room", () => {
      const broadcaster = broadcasterManager.get(roomKey);
      expect(broadcaster).toBeDefined();
    });

    it("returns the same broadcaster for the same room", () => {
      const broadcaster1 = broadcasterManager.get(roomKey);
      const broadcaster2 = broadcasterManager.get(roomKey);
      expect(broadcaster1).toBe(broadcaster2);
    });

    it("returns different broadcasters for different rooms", () => {
      const broadcaster1 = broadcasterManager.get(roomKey);
      const broadcaster2 = broadcasterManager.get("different-room");
      expect(broadcaster1).not.toBe(broadcaster2);
    });
  });

  describe("remove()", () => {
    it("removes a room's broadcaster", () => {
      const broadcaster1 = broadcasterManager.get(roomKey);
      broadcasterManager.remove(roomKey);

      // After removal, a new broadcaster is created
      const broadcaster2 = broadcasterManager.get(roomKey);
      expect(broadcaster1).not.toBe(broadcaster2);
    });

    it("clears listeners when removing", () => {
      const broadcaster = broadcasterManager.get(roomKey);
      let callCount = 0;
      broadcaster.onEvent(() => {
        callCount++;
      });

      broadcasterManager.remove(roomKey);

      // Emitting to removed room should not crash
      const newBroadcaster = broadcasterManager.get(roomKey);
      newBroadcaster.emit({
        type: "state_change",
        roomId: "!room:server",
        roomKey,
        sessionId: "session-id",
        changeType: "processing_end",
        timestamp: new Date().toISOString(),
      } as WebUIEvent);

      // Original listener should not have been called
      expect(callCount).toBe(0);
    });
  });

  describe("onEvent()", () => {
    it("adds an event listener", () => {
      const broadcaster = broadcasterManager.get(roomKey);
      let receivedEvent: WebUIEvent | null = null;

      broadcaster.onEvent((event) => {
        receivedEvent = event;
      });

      const testEvent: WebUIEvent = {
        type: "state_change",
        roomId: "!room:server",
        roomKey,
        sessionId: "session-id",
        changeType: "processing_end",
        timestamp: new Date().toISOString(),
      };

      broadcaster.emit(testEvent);

      expect(receivedEvent).toBe(testEvent);
    });

    it("returns a cleanup function", () => {
      const broadcaster = broadcasterManager.get(roomKey);
      let callCount = 0;

      const cleanup = broadcaster.onEvent(() => {
        callCount++;
      });

      broadcaster.emit({
        type: "state_change",
        roomId: "!room:server",
        roomKey,
        sessionId: "session-id",
        changeType: "processing_end",
        timestamp: new Date().toISOString(),
      } as WebUIEvent);

      expect(callCount).toBe(1);

      // Cleanup
      cleanup();

      broadcaster.emit({
        type: "state_change",
        roomId: "!room:server",
        roomKey,
        sessionId: "session-id",
        changeType: "processing_end",
        timestamp: new Date().toISOString(),
      } as WebUIEvent);

      // Should not have been called again
      expect(callCount).toBe(1);
    });

    it("supports multiple listeners", () => {
      const broadcaster = broadcasterManager.get(roomKey);
      let callCount1 = 0;
      let callCount2 = 0;

      broadcaster.onEvent(() => {
        callCount1++;
      });
      broadcaster.onEvent(() => {
        callCount2++;
      });

      broadcaster.emit({
        type: "state_change",
        roomId: "!room:server",
        roomKey,
        sessionId: "session-id",
        changeType: "processing_end",
        timestamp: new Date().toISOString(),
      } as WebUIEvent);

      expect(callCount1).toBe(1);
      expect(callCount2).toBe(1);
    });
  });

  describe("emit()", () => {
    it("emits an event to all listeners", () => {
      const broadcaster = broadcasterManager.get(roomKey);
      const events: WebUIEvent[] = [];

      broadcaster.onEvent((event) => {
        events.push(event);
      });

      const testEvent: WebUIEvent = {
        type: "state_change",
        roomId: "!room:server",
        roomKey,
        sessionId: "session-id",
        changeType: "processing_end",
        timestamp: new Date().toISOString(),
      };

      broadcaster.emit(testEvent);

      expect(events).toHaveLength(1);
      expect(events[0]).toBe(testEvent);
    });

    it("handles listener errors gracefully", () => {
      const broadcaster = broadcasterManager.get(roomKey);
      let goodListenerCalled = false;

      // Bad listener that throws
      broadcaster.onEvent(() => {
        throw new Error("Test error");
      });

      // Good listener
      broadcaster.onEvent(() => {
        goodListenerCalled = true;
      });

      // Should not crash
      expect(() => {
        broadcaster.emit({
          type: "state_change",
          roomId: "!room:server",
          roomKey,
          sessionId: "session-id",
          changeType: "processing_end",
          timestamp: new Date().toISOString(),
        } as WebUIEvent);
      }).not.toThrow();

      // Good listener should still have been called
      expect(goodListenerCalled).toBe(true);
    });

    it("emits state_change event for processing_end", () => {
      const broadcaster = broadcasterManager.get(roomKey);
      let receivedEvent: WebUIEvent | null = null;

      broadcaster.onEvent((event) => {
        receivedEvent = event;
      });

      const testEvent: WebUIEvent = {
        type: "state_change",
        roomId: "!room:server",
        roomKey,
        sessionId: "session-id",
        changeType: "processing_end",
        timestamp: new Date().toISOString(),
      };

      broadcaster.emit(testEvent);

      expect(receivedEvent?.type).toBe("state_change");
      expect(receivedEvent?.changeType).toBe("processing_end");
    });
  });
});
