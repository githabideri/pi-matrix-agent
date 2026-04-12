import type { IncomingMessage, AgentBackend, ReplySink, RouterConfig } from "./types.js";
import { parseCommand } from "./command.js";
import { isAllowedRoom, isAllowedUser } from "./policy.js";

// Interface for session reset capability
export interface SessionResetter {
  reset(roomId: string): Promise<void>;
}

export interface RouterOptions {
  config: RouterConfig;
  sessionRegistry?: SessionResetter;
  controlUrl?: string; // Base URL for control server
  setTyping?: (roomId: string, typing: boolean) => Promise<void>;
  startTypingLoop?: (roomId: string) => NodeJS.Timeout;
  stopTypingLoop?: (interval: NodeJS.Timeout) => void;
}

export async function routeMessage(
  msg: IncomingMessage,
  options: RouterOptions
): Promise<void> {
  const config = options.config;

  // Check if room is allowed
  if (!isAllowedRoom(msg.roomId, config.allowedRoomIds)) {
    return;
  }

  // Check if user is allowed
  if (!isAllowedUser(msg.sender, config.allowedUserIds)) {
    return;
  }

  // Parse the command
  const command = parseCommand(msg.body);

  // Handle different command types
  switch (command.kind) {
    case "command_ping":
      await config.sink.reply(msg.roomId, msg.eventId, "pong");
      return;

    case "command_status":
      await config.sink.reply(msg.roomId, msg.eventId, "Status: OK");
      return;

    case "command_help":
      await config.sink.reply(
        msg.roomId,
        msg.eventId,
        "Commands:\n" +
          "  !ping    - Check if bot is alive\n" +
          "  !status  - Show bot status\n" +
          "  !reset   - Clear conversation memory\n" +
          "  !control - Get control URL for this room\n" +
          "  !help    - Show this help\n" +
          "\nPlain text messages are sent to pi for inference."
      );
      return;

    case "command_reset":
      // Reset the live session for this room (archives old one, creates new)
      console.log(`[Router] !reset command for room ${msg.roomId}`);
      try {
        if (options.sessionRegistry) {
          console.log(`[Router] Calling reset() for room ${msg.roomId}`);
          await options.sessionRegistry.reset(msg.roomId);
          console.log(`[Router] Reset completed for room ${msg.roomId}`);
        }
        await config.sink.reply(msg.roomId, msg.eventId, "Session reset. Previous session archived.");
      } catch (error) {
        console.error(`[Router] Error resetting session for room ${msg.roomId}:`, error);
        await config.sink.reply(msg.roomId, msg.eventId, "Failed to reset session. Check logs.");
      }
      return;

    case "command_session":
      await config.sink.reply(msg.roomId, msg.eventId, "Session info: active for this room");
      return;

    case "command_control":
      if (options.controlUrl) {
        // Get room key for URL
        const roomState = (options.sessionRegistry as any)?.getLiveRoomInfo?.(msg.roomId);
        if (roomState && roomState.roomKey) {
          const controlUrl = `${options.controlUrl}/room/${roomState.roomKey}`;
          await config.sink.reply(msg.roomId, msg.eventId, `Control view: ${controlUrl}`);
        } else {
          await config.sink.reply(msg.roomId, msg.eventId, "Control URL unavailable - room not found in live state.");
        }
      } else {
        await config.sink.reply(msg.roomId, msg.eventId, "Control server not configured.");
      }
      return;

    case "chat_prompt":
      // Start typing indicator
      let typingInterval: NodeJS.Timeout | undefined;
      if (options.startTypingLoop) {
        typingInterval = options.startTypingLoop(msg.roomId);
      }

      try {
        const response = await config.agent.prompt(msg.roomId, command.prompt);
        await config.sink.reply(msg.roomId, msg.eventId, response);
      } catch (error) {
        console.error(`Error processing prompt:`, error);
        await config.sink.reply(msg.roomId, msg.eventId, "Sorry, an error occurred while processing your request.");
      } finally {
        // Stop typing indicator
        if (typingInterval && options.stopTypingLoop) {
          options.stopTypingLoop(typingInterval);
        }
      }
      return;
  }
}
