import type { ParsedCommand } from "./types.js";

export function parseCommand(body: string): ParsedCommand {
  const trimmed = body.trim();

  // If message starts with !, treat as control command
  if (trimmed.startsWith("!")) {
    const commandPart = trimmed.slice(1).trim();

    // Empty command or lone ! -> help
    if (commandPart === "") {
      return { kind: "command_help" };
    }

    // Parse known commands
    switch (commandPart.toLowerCase()) {
      case "ping":
        return { kind: "command_ping" };
      case "status":
        return { kind: "command_status" };
      case "reset":
        return { kind: "command_reset" };
      case "help":
        return { kind: "command_help" };
      case "session":
        return { kind: "command_session" };
      case "control":
        return { kind: "command_control" };
      default:
        // Unknown command -> help
        return { kind: "command_help" };
    }
  }

  // Plain text -> chat prompt
  return { kind: "chat_prompt", prompt: trimmed };
}
