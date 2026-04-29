import type { ParsedCommand } from "./types.js";

// Model profile registry - maps aliases to canonical profile names
const MODEL_ALIASES: Record<string, string> = {
  q27: "qwen27",
  q36: "qwen36",
};

// Canonical profile names (lowercase)
const CANONICAL_PROFILES = new Set(["qwen27", "qwen36"]);

/**
 * Resolve a model profile name or alias to canonical form.
 * Returns undefined if the profile is not recognized.
 */
export function resolveModelProfile(rawProfile: string): string | undefined {
  const lower = rawProfile.toLowerCase();
  // Check if it's a canonical profile
  if (CANONICAL_PROFILES.has(lower)) {
    return lower;
  }
  // Check if it's an alias
  if (MODEL_ALIASES[lower]) {
    return MODEL_ALIASES[lower];
  }
  return undefined;
}

export function parseCommand(body: string): ParsedCommand {
  const trimmed = body.trim();

  // If message starts with !, treat as control command
  if (trimmed.startsWith("!")) {
    const commandPart = trimmed.slice(1).trim();

    // Empty command or lone ! -> help
    if (commandPart === "") {
      return { kind: "command_help" };
    }

    // Split command from arguments
    const parts = commandPart.split(/\s+/);
    const commandWord = parts[0].toLowerCase();
    const firstArg = parts.length > 1 ? parts[1].toLowerCase() : undefined;

    // Parse !model and !m commands with potential argument
    if (commandWord === "model" || commandWord === "m") {
      // Validate: exactly 1-2 parts allowed
      if (parts.length > 2) {
        return { kind: "command_help" }; // Malformed - too many args
      }

      // !model or !m with no arg -> status
      if (!firstArg) {
        return { kind: "command_model_status" };
      }

      // !model --status, !m --status, !m -s -> status
      if (firstArg === "--status" || firstArg === "-s") {
        return { kind: "command_model_status" };
      }

      // !model --clear, !m --clear, !m -c -> clear room override
      if (firstArg === "--clear" || firstArg === "-c") {
        return { kind: "command_model_clear" };
      }

      // !model <profile> or !m <alias> -> switch (with canonicalization)
      const resolvedProfile = resolveModelProfile(firstArg);
      if (resolvedProfile) {
        return { kind: "command_model_switch", profile: resolvedProfile };
      }
      // Invalid profile - still parse as switch, validation happens in router
      return { kind: "command_model_switch", profile: firstArg };
    }

    // Parse !media: !media <url> [caption]
    if (commandWord === "media") {
      const urlAndCaption = commandPart.slice(5).trim(); // strip "media"
      const parts = urlAndCaption.split(/\s+/);
      const url = parts[0];
      const caption = parts.length > 1 ? parts.slice(1).join(" ").trim() : undefined;
      if (url) {
        return { kind: "command_media", url, caption };
      }
      // !media with no URL -> help
      return { kind: "command_help" };
    }

    // Parse other known commands (no arguments expected)
    switch (commandWord) {
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
