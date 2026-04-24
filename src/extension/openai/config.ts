import type * as vscode from "vscode";

const SECRET_KEY = "gsd.openaiApiKey";

export async function getOpenAiApiKey(secrets: vscode.SecretStorage): Promise<string | undefined> {
  return secrets.get(SECRET_KEY);
}

export async function setOpenAiApiKey(secrets: vscode.SecretStorage, key: string): Promise<void> {
  await secrets.store(SECRET_KEY, key);
}

export async function deleteOpenAiApiKey(secrets: vscode.SecretStorage): Promise<void> {
  await secrets.delete(SECRET_KEY);
}
