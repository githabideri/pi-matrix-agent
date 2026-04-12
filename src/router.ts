import type { IncomingMessage, AgentBackend, ReplySink, RouterConfig } from "./types.js";
import type { SessionRegistry } from "./sessions.js";
import { parseCommand } from "./command.js";
import { isAllowedRoom, isAllowedUser } from "./policy.js";

export interface RouterOptions {
  config: RouterConfig;
  sessionRegistry?: SessionRegistry<any>;
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
          "  !ping   - Check if bot is alive\n" +
          "  !status - Show bot status\n" +
          "  !reset  - Clear conversation memory\n" +
          "  !help   - Show this help\n" +
          "\nPlain text messages are sent to pi for inference."
      );
      return;

    case "command_reset":
      // Drop the session for this room
      options.sessionRegistry?.drop(msg.roomId);
      await config.sink.reply(msg.roomId, msg.eventId, "Session reset complete.");
      return;

    case "command_session":
      await config.sink.reply(msg.roomId, msg.eventId, "Session info: active for this room");
      return;

    case "chat_prompt":
      const response = await config.agent.prompt(msg.roomId, command.prompt);
      await config.sink.reply(msg.roomId, msg.eventId, response);
      return;
  }
}
