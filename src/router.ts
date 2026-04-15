import { parseCommand } from "./command.js";
import { isAllowedRoom, isAllowedUser } from "./policy.js";
import type { IncomingMessage, RouterConfig } from "./types.js";

// Interface for session reset capability
export interface SessionResetter {
  reset(roomId: string): Promise<void>;
}

// Interface for model switching capability
export interface ModelSwitcher {
  switchModel?(roomId: string, profile: string): Promise<any>;
  getModelStatus?(roomId: string): Promise<any>;
}

export interface RouterOptions {
  config: RouterConfig;
  sessionRegistry?: SessionResetter;
  modelSwitcher?: ModelSwitcher;
  controlUrl?: string; // Base URL for control server
  setTyping?: (roomId: string, typing: boolean) => Promise<void>;
  startTypingLoop?: (roomId: string) => NodeJS.Timeout;
  stopTypingLoop?: (interval: NodeJS.Timeout) => void;
  isRoomProcessing?: (roomId: string) => boolean;
}

export async function routeMessage(msg: IncomingMessage, options: RouterOptions): Promise<void> {
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
          "\nModel switching (Phase 2 - room-persistent):\n" +
          "  !model        - Show current model status\n" +
          "  !model --status - Show current model status\n" +
          "  !model --clear  - Clear room override (fall back to global)\n" +
          "  !model gemma4 - Switch to Gemma4 model\n" +
          "  !model qwen27 - Switch to Qwen27 model\n" +
          "\nShort aliases:\n" +
          "  !m -s         - Show status (alias for !model --status)\n" +
          "  !m -c         - Clear room override (alias for !model --clear)\n" +
          "  !m g4         - Switch to Gemma4 (alias)\n" +
          "  !m q27        - Switch to Qwen27 (alias)\n" +
          "\nPhase 2 features:\n" +
          "  - Model switch is room-persistent (survives restart and !reset)\n" +
          "  - Does not contaminate global default for other rooms\n" +
          "  - !model --clear removes room override, falls back to global\n" +
          "\nNote: Model switch is rejected while a turn is in progress.\n" +
          "\nPlain text messages are sent to pi for inference.",
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
        if (roomState?.roomKey) {
          // Primary: Assistant UI Spike
          const spikeUrl = `${options.controlUrl}/spike?room=${encodeURIComponent(roomState.roomKey)}`;
          await config.sink.reply(msg.roomId, msg.eventId, `Assistant UI: ${spikeUrl}`);
        } else {
          // Room not in live state yet - user needs to send a message first
          await config.sink.reply(
            msg.roomId,
            msg.eventId,
            "No active session yet. Send a message first, then try !control.",
          );
        }
      } else {
        await config.sink.reply(msg.roomId, msg.eventId, "Control server not configured.");
      }
      return;

    case "command_model_status": {
      // Get model status from backend
      const modelSwitcher = options.modelSwitcher;
      if (modelSwitcher?.getModelStatus) {
        try {
          // Use rehydration-aware status method if available, otherwise fall back to regular method
          const getModelStatusWithRehydration = (modelSwitcher as any).getModelStatusWithRehydration;
          const status = getModelStatusWithRehydration
            ? await getModelStatusWithRehydration(msg.roomId)
            : await modelSwitcher.getModelStatus(msg.roomId);

          // Check if this is a persisted room (has desired model but not live)
          const isPersistedRoom = status?._persisted === true;

          if (!status && !isPersistedRoom) {
            await config.sink.reply(
              msg.roomId,
              msg.eventId,
              "No active session for this room yet. Send a message first.",
            );
          } else if (isPersistedRoom) {
            // Persisted room - show desired model status without requiring live session
            const lines: string[] = [];
            lines.push("Model status (persisted room):");
            lines.push("  Status: Not currently active (send a message to activate)");

            if (status?.desiredModel) {
              const resolvedInfo = status.desiredResolvedModelId ? ` (resolved: ${status.desiredResolvedModelId})` : "";
              lines.push(`  Desired model: ${status.desiredModel}${resolvedInfo}`);
            }

            if (status?.globalDefault) {
              lines.push(`  Global default: ${status.globalDefault}`);
            }

            lines.push("");
            lines.push("  Send any message to activate this room and apply the desired model.");

            await config.sink.reply(msg.roomId, msg.eventId, lines.join("\n"));
          } else {
            // Build status reply
            const lines: string[] = [];
            lines.push("Model status:");

            // Active runtime model
            if (status.model) {
              const mismatchIndicator = status.modelMismatch ? " ⚠️" : "";
              lines.push(`  Active model: ${status.model}${mismatchIndicator}`);
            } else {
              lines.push("  Active model: Not set");
            }

            // Thinking level
            if (status.thinkingLevel) {
              lines.push(`  Thinking level: ${status.thinkingLevel}`);
            }

            // Phase 2: Desired model info
            if (status.desiredModel) {
              const resolvedInfo = status.desiredResolvedModelId ? ` (resolved: ${status.desiredResolvedModelId})` : "";
              lines.push(`  Desired model: ${status.desiredModel}${resolvedInfo}`);
            } else {
              lines.push("  Desired model: None (using global default)");
            }

            // Global default
            if (status.globalDefault) {
              lines.push(`  Global default: ${status.globalDefault}`);
            }

            // Session info
            if (status.sessionId) {
              lines.push(`  Session ID: ${status.sessionId}`);
            }
            lines.push(`  Session file: ${status.sessionFile || "N/A"}`);

            // Status
            if (status.isProcessing) {
              lines.push("  Status: Processing (busy)");
            } else {
              lines.push("  Status: Idle");
            }

            // Phase 2: Mismatch warning
            if (status.modelMismatch) {
              lines.push("");
              lines.push("  ⚠️ Active model differs from desired.");
              lines.push("  Send a message to apply the desired model.");
            }

            await config.sink.reply(msg.roomId, msg.eventId, lines.join("\n"));
          }
        } catch (error: any) {
          console.error(`[Router] Error getting model status:`, error);
          await config.sink.reply(msg.roomId, msg.eventId, "Failed to get model status.");
        }
      } else {
        await config.sink.reply(msg.roomId, msg.eventId, "Model status not available.");
      }
      return;
    }

    case "command_model_switch": {
      // Check if room is processing
      if (options.isRoomProcessing?.(msg.roomId)) {
        await config.sink.reply(
          msg.roomId,
          msg.eventId,
          `Cannot switch model while a turn is in progress; try again once idle.`,
        );
        return;
      }

      // Get model switcher from options
      const modelSwitcher = options.modelSwitcher;
      if (modelSwitcher?.switchModel) {
        try {
          const result = await modelSwitcher.switchModel(msg.roomId, command.profile);

          if (result.success) {
            // Build success reply with verification
            const lines: string[] = [];
            lines.push(`✓ Model switch successful`);
            lines.push(`  Requested: ${command.profile}`);
            if (result.resolvedModel) {
              lines.push(`  Resolved to: ${result.resolvedModel}`);
            }
            if (result.activeModel) {
              lines.push(`  Active model: ${result.activeModel}`);
            }
            lines.push("");

            await config.sink.reply(msg.roomId, msg.eventId, lines.join("\n"));
          } else {
            // Failed switch
            await config.sink.reply(msg.roomId, msg.eventId, `✗ ${result.message}`);
          }
        } catch (error: any) {
          console.error(`[Router] Error switching model:`, error);
          await config.sink.reply(msg.roomId, msg.eventId, `Failed to switch model: ${error.message}`);
        }
      } else {
        await config.sink.reply(msg.roomId, msg.eventId, "Model switching not available.");
      }
      return;
    }

    case "command_model_clear": {
      // Get model switcher from options
      const modelSwitcher = options.modelSwitcher;
      if (modelSwitcher && (modelSwitcher as any).clearDesiredModel) {
        try {
          const result = await (modelSwitcher as any).clearDesiredModel(msg.roomId);

          if (result.success) {
            const lines: string[] = [];
            lines.push(`✓ Desired model cleared for this room`);
            lines.push(`  ${result.message}`);
            if (result.previousDesiredModel) {
              lines.push(`  Previous desired: ${result.previousDesiredModel}`);
            }
            lines.push("");
            lines.push("This room will now use the global default model.");

            await config.sink.reply(msg.roomId, msg.eventId, lines.join("\n"));
          } else {
            await config.sink.reply(msg.roomId, msg.eventId, `✗ ${result.message}`);
          }
        } catch (error: any) {
          console.error(`[Router] Error clearing desired model:`, error);
          await config.sink.reply(msg.roomId, msg.eventId, `Failed to clear desired model: ${error.message}`);
        }
      } else {
        await config.sink.reply(msg.roomId, msg.eventId, "Clear desired model not available.");
      }
      return;
    }

    case "chat_prompt": {
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
}
