import { TranscriptionError } from "../openai/transcribe";

export type TranscriptionProvider = "openai" | "azure" | "xai";

export interface TranscriptionConfig {
  provider: TranscriptionProvider;
  apiKey: string;
  azureRegion?: string;
}

export async function transcribeWithProvider(
  config: TranscriptionConfig,
  audioBuffer: Buffer,
  filename = "voice.ogg",
): Promise<string> {
  switch (config.provider) {
    case "openai":
      return transcribeOpenAI(config.apiKey, audioBuffer, filename);
    case "azure":
      return transcribeAzure(config.apiKey, config.azureRegion ?? "eastus", audioBuffer);
    case "xai":
      return transcribeXAI(config.apiKey, audioBuffer, filename);
    default:
      throw new TranscriptionError(`Unknown transcription provider: ${config.provider}`);
  }
}

async function transcribeOpenAI(apiKey: string, audioBuffer: Buffer, filename: string): Promise<string> {
  const form = new FormData();
  form.append("model", "whisper-1");
  form.append("file", new Blob([new Uint8Array(audioBuffer)]), filename);

  const response = await fetchWithTimeout("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  const body = await response.text();
  if (!response.ok) {
    throw new TranscriptionError(`OpenAI Whisper error: ${parseErrorDetail(body)}`, response.status);
  }
  return (JSON.parse(body) as { text: string }).text.trim();
}

async function transcribeXAI(apiKey: string, audioBuffer: Buffer, filename: string): Promise<string> {
  const form = new FormData();
  form.append("model", "whisper-large-v3");
  form.append("file", new Blob([new Uint8Array(audioBuffer)]), filename);

  const response = await fetchWithTimeout("https://api.x.ai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  const body = await response.text();
  if (!response.ok) {
    throw new TranscriptionError(`xAI transcription error: ${parseErrorDetail(body)}`, response.status);
  }
  return (JSON.parse(body) as { text: string }).text.trim();
}

async function transcribeAzure(apiKey: string, region: string, audioBuffer: Buffer): Promise<string> {
  const url = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US`;

  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": apiKey,
      "Content-Type": "audio/ogg; codecs=opus",
      Accept: "application/json",
    },
    body: audioBuffer,
  });

  const body = await response.text();
  if (!response.ok) {
    throw new TranscriptionError(`Azure Speech error: ${parseErrorDetail(body)}`, response.status);
  }

  const parsed = JSON.parse(body) as { RecognitionStatus: string; DisplayText?: string };
  if (parsed.RecognitionStatus !== "Success") {
    throw new TranscriptionError(`Azure Speech recognition failed: ${parsed.RecognitionStatus}`);
  }
  return (parsed.DisplayText ?? "").trim();
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 60_000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new TranscriptionError("Transcription request timed out after 60s");
    }
    throw new TranscriptionError(`Transcription network error: ${(err as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function validateApiKey(provider: TranscriptionProvider, apiKey: string, azureRegion?: string): Promise<boolean> {
  try {
    switch (provider) {
      case "openai":
        return await validateOpenAIKey(apiKey);
      case "xai":
        return await validateXAIKey(apiKey);
      case "azure":
        return await validateAzureKey(apiKey, azureRegion ?? "eastus");
    }
  } catch {
    return false;
  }
}

async function validateOpenAIKey(apiKey: string): Promise<boolean> {
  const res = await fetchWithTimeout("https://api.openai.com/v1/models", {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  }, 10_000);
  return res.ok;
}

async function validateXAIKey(apiKey: string): Promise<boolean> {
  const res = await fetchWithTimeout("https://api.x.ai/v1/models", {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  }, 10_000);
  return res.ok;
}

async function validateAzureKey(apiKey: string, region: string): Promise<boolean> {
  const res = await fetchWithTimeout(
    `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
    {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": apiKey,
        "Content-Length": "0",
      },
    },
    10_000,
  );
  return res.ok;
}

function parseErrorDetail(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    return parsed.error?.message ?? body;
  } catch {
    return body;
  }
}
