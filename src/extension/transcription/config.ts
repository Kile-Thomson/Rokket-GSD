import type * as vscode from "vscode";
import type { TranscriptionProvider } from "./providers";

const KEYS = {
  openai: "gsd.openaiApiKey",
  azure: "gsd.azureSpeechApiKey",
  xai: "gsd.xaiApiKey",
} as const;

const AZURE_REGION_KEY = "azureSpeechRegion";
const PROVIDER_KEY = "voiceTranscriptionProvider";

export async function getTranscriptionApiKey(
  secrets: vscode.SecretStorage,
  provider: TranscriptionProvider,
): Promise<string | undefined> {
  return secrets.get(KEYS[provider]);
}

export async function setTranscriptionApiKey(
  secrets: vscode.SecretStorage,
  provider: TranscriptionProvider,
  key: string,
): Promise<void> {
  await secrets.store(KEYS[provider], key);
}

export async function deleteTranscriptionApiKey(
  secrets: vscode.SecretStorage,
  provider: TranscriptionProvider,
): Promise<void> {
  await secrets.delete(KEYS[provider]);
}

export function getVoiceProvider(config: vscode.WorkspaceConfiguration): TranscriptionProvider {
  return (config.get<string>(PROVIDER_KEY) ?? "openai") as TranscriptionProvider;
}

export function getAzureRegion(config: vscode.WorkspaceConfiguration): string {
  return config.get<string>(AZURE_REGION_KEY) ?? "eastus";
}

