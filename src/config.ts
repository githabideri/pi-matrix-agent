import { readFileSync } from "fs";

export interface Config {
  homeserverUrl: string;
  accessToken: string;
  botUserId: string;
  allowedRoomIds: string[];
  allowedUserIds: string[];
  commandPrefix: string;
  workingDirectory: string;
  sessionBaseDir: string;
  storageFile: string;
  inferenceBaseUrl: string;
  inferenceModel: string;
  inferenceApiKey: string;
  inferenceMaxTokens?: number;
  // Control server config
  controlPort?: number;
  controlHost?: string;
}

export function loadConfig(): Config {
  const configPath = process.env.CONFIG_FILE || "./config.json";
  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  return config as Config;
}

/**
 * Get control server port from env or config, with default.
 */
export function getControlPort(): number {
  const envPort = process.env.CONTROL_PORT;
  if (envPort) {
    const parsed = parseInt(envPort, 10);
    if (!isNaN(parsed)) {
      return parsed;
    }
  }
  // Default port
  return 9000;
}

/**
 * Get control server host from env or config, with default.
 * Default to 127.0.0.1 - Tailscale Serve exposes it to tailnet.
 */
export function getControlHost(): string {
  return process.env.CONTROL_HOST || "127.0.0.1";
}

/**
 * Get public control server URL for !control command.
 * This is the Tailscale Serve URL (MagicDNS), not localhost or raw IP.
 * Set via CONTROL_PUBLIC_URL env var or config.controlPublicUrl.
 */
export function getControlPublicUrl(config: any): string {
  // Env var takes precedence
  if (process.env.CONTROL_PUBLIC_URL) {
    return process.env.CONTROL_PUBLIC_URL;
  }
  // Fall back to config field
  if (config?.controlPublicUrl) {
    return config.controlPublicUrl;
  }
  // Default placeholder - user should configure this
  return "http://localhost:9000";
}
