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
}

export function loadConfig(): Config {
  const configPath = process.env.CONFIG_FILE || "./config.json";
  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  return config as Config;
}
