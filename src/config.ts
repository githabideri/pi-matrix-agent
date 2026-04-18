import { existsSync, mkdirSync, readFileSync } from "fs";

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
  // Dedicated Pi agent directory for bot isolation
  agentDir: string;
  // Control server config
  controlPort?: number;
  controlHost?: string;
  // Control public URL (fallback, env var takes precedence)
  controlPublicUrl?: string;
  // Control server authentication (optional)
  controlAuthUser?: string;
  controlAuthPassword?: string;
}

export interface RuntimeConfig {
  config: Config;
  configPath: string;
  controlPort: number;
  controlHost: string;
  controlPublicUrl: string;
  frontendDistPath: string;
  frontendDistExists: boolean;
  controlAuth?: ControlAuthConfig;
}

export function loadConfig(): Config {
  const configPath = process.env.CONFIG_FILE || "./config.json";
  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  return config as Config;
}

/**
 * Get control server port from env or config, with default.
 * Resolution order: 1. CONTROL_PORT env var, 2. config.controlPort, 3. default 9000
 */
export function getControlPort(config: Config): number {
  // 1. Env var takes precedence
  const envPort = process.env.CONTROL_PORT;
  if (envPort) {
    const parsed = parseInt(envPort, 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  // 2. Config file value
  if (config?.controlPort) {
    return config.controlPort;
  }
  // 3. Default port
  return 9000;
}

/**
 * Get control server host from env or config, with default.
 * Resolution order: 1. CONTROL_HOST env var, 2. config.controlHost, 3. default 127.0.0.1
 * Default to 127.0.0.1 - Tailscale Serve exposes it to tailnet.
 */
export function getControlHost(config: Config): string {
  // 1. Env var takes precedence
  if (process.env.CONTROL_HOST) {
    return process.env.CONTROL_HOST;
  }
  // 2. Config file value
  if (config?.controlHost) {
    return config.controlHost;
  }
  // 3. Default host
  return "127.0.0.1";
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

export interface ControlAuthConfig {
  username: string;
  password: string;
}

/**
 * Get control server authentication config from env or config.
 * Resolution order: 1. CONTROL_AUTH_USER / CONTROL_AUTH_PASSWORD env vars, 2. config.controlAuthUser / config.controlAuthPassword
 * Returns undefined if neither username nor password is set.
 * Logs a warning and returns undefined if only one is set.
 */
export function getControlAuth(config: Config): ControlAuthConfig | undefined {
  // 1. Env vars take precedence
  const envUser = process.env.CONTROL_AUTH_USER;
  const envPass = process.env.CONTROL_AUTH_PASSWORD;

  // 2. Config file values
  const configUser = config?.controlAuthUser;
  const configPass = config?.controlAuthPassword;

  // Use env vars if set, otherwise use config values
  const username = envUser ?? configUser;
  const password = envPass ?? configPass;

  // If neither is set, auth is disabled
  if (!username && !password) {
    return undefined;
  }

  // If only one is set, log a warning and return undefined
  if (!username || !password) {
    console.warn(
      "[Control Auth] Incomplete configuration: both username and password must be set. " +
        "Auth is disabled. Set both CONTROL_AUTH_USER and CONTROL_AUTH_PASSWORD env vars, " +
        "or both controlAuthUser and controlAuthPassword in config.json.",
    );
    return undefined;
  }

  return { username, password };
}

/**
 * Validate runtime prerequisites and log warnings.
 * Does not crash - only logs warnings.
 */
export function validateRuntime(config: Config): void {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Check CONTROL_PUBLIC_URL
  if (!process.env.CONTROL_PUBLIC_URL && !config.controlPublicUrl) {
    warnings.push(
      "CONTROL_PUBLIC_URL not set. !control will return fallback/local URLs instead of public Tailscale URL. " +
        "Set CONTROL_PUBLIC_URL=https://<your-node>.<tailnet>.ts.net at startup for correct behavior.",
    );
  }

  // Check agentDir
  if (!config.agentDir) {
    errors.push("agentDir is missing from config.json. Bot isolation will not work correctly.");
  } else if (!existsSync(config.agentDir)) {
    warnings.push(`agentDir '${config.agentDir}' does not exist. It will be created on first use.`);
  }

  // Check workingDirectory
  if (config.workingDirectory && !existsSync(config.workingDirectory)) {
    errors.push(`workingDirectory '${config.workingDirectory}' does not exist.`);
  }

  // Check sessionBaseDir
  if (!existsSync(config.sessionBaseDir)) {
    warnings.push(`sessionBaseDir '${config.sessionBaseDir}' does not exist. It will be created on first use.`);
  }

  // Check frontend dist directory
  const frontendDistPath = "./frontend/operator-ui/dist";
  const frontendDistExists = existsSync(frontendDistPath) && existsSync(`${frontendDistPath}/index.html`);
  if (!frontendDistExists) {
    warnings.push(
      `Frontend not built at '${frontendDistPath}/index.html'. "` +
        `/app/room/:roomKey" will not work until frontend is built. Run: cd frontend/operator-ui && npm run build`,
    );
  }

  // Log errors
  for (const error of errors) {
    console.error(`[Runtime Validation] ERROR: ${error}`);
  }

  // Log warnings
  for (const warning of warnings) {
    console.warn(`[Runtime Validation] WARNING: ${warning}`);
  }

  // Create missing directories if needed
  if (config.agentDir && !existsSync(config.agentDir)) {
    try {
      mkdirSync(config.agentDir, { recursive: true });
      console.log(`[Runtime Validation] Created agentDir: ${config.agentDir}`);
    } catch (err) {
      console.error(`[Runtime Validation] Failed to create agentDir '${config.agentDir}':`, err);
    }
  }

  if (!existsSync(config.sessionBaseDir)) {
    try {
      mkdirSync(config.sessionBaseDir, { recursive: true });
      console.log(`[Runtime Validation] Created sessionBaseDir: ${config.sessionBaseDir}`);
    } catch (err) {
      console.error(`[Runtime Validation] Failed to create sessionBaseDir '${config.sessionBaseDir}':`, err);
    }
  }

  // Exit if critical errors
  if (errors.length > 0) {
    console.error(`[Runtime Validation] ${errors.length} critical error(s) found. Aborting startup.`);
    process.exit(1);
  }
}

/**
 * Print effective runtime config summary.
 */
export function printRuntimeConfig(
  config: Config,
  controlPort: number,
  controlHost: string,
  controlPublicUrl: string,
  controlAuth?: ControlAuthConfig,
): void {
  const frontendDistPath = "./frontend/operator-ui/dist";
  const frontendDistExists = existsSync(frontendDistPath) && existsSync(`${frontendDistPath}/index.html`);

  console.log("==========================================================");
  console.log("           PI-MATRIX-AGENT RUNTIME CONFIG");
  console.log("==========================================================");
  console.log(`Config file:      ${process.env.CONFIG_FILE || "./config.json"}`);
  console.log(`Working dir:      ${config.workingDirectory || process.cwd()}`);
  console.log(`Session base:     ${config.sessionBaseDir}`);
  console.log(`Agent dir:        ${config.agentDir}`);
  console.log(`Storage file:     ${config.storageFile}`);
  console.log(`------------------------------------------------------`);
  console.log(`Matrix homeserver:  ${config.homeserverUrl}`);
  console.log(`Bot user ID:      ${config.botUserId}`);
  console.log(`Allowed rooms:    ${config.allowedRoomIds.length}`);
  console.log(`Allowed users:    ${config.allowedUserIds.length}`);
  console.log(`------------------------------------------------------`);
  console.log(`Control host:       ${controlHost}`);
  console.log(`Control port:       ${controlPort}`);
  console.log(`Control URL:        http://${controlHost}:${controlPort}`);
  console.log(`Control public URL: ${controlPublicUrl}`);
  console.log(`Control auth:       ${controlAuth ? "enabled" : "disabled"}`);
  console.log(`------------------------------------------------------`);
  console.log(`Frontend dist:      ${frontendDistPath}`);
  console.log(`Frontend built:     ${frontendDistExists ? "yes" : "no"}`);
  console.log("==========================================================");
}

/**
 * Load config and compute full runtime configuration.
 */
export function loadRuntimeConfig(): RuntimeConfig {
  const configPath = process.env.CONFIG_FILE || "./config.json";
  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  const controlPort = getControlPort(config);
  const controlHost = getControlHost(config);
  const controlPublicUrl = getControlPublicUrl(config);
  const controlAuth = getControlAuth(config);
  const frontendDistPath = "./frontend/operator-ui/dist";
  const frontendDistExists = existsSync(frontendDistPath) && existsSync(`${frontendDistPath}/index.html`);

  return {
    config: config as Config,
    configPath,
    controlPort,
    controlHost,
    controlPublicUrl,
    controlAuth,
    frontendDistPath,
    frontendDistExists,
  };
}
