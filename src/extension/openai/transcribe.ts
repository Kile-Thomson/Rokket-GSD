export class TranscriptionError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "TranscriptionError";
  }
}

/**
 * Transcribe audio from a Buffer using OpenAI Whisper API (whisper-1).
 * filename hint is used by the API to detect format (e.g. "voice.ogg").
 */
export async function transcribeAudio(apiKey: string, audioBuffer: Buffer, filename = "voice.ogg"): Promise<string> {
  const form = new FormData();
  form.append("model", "whisper-1");
  form.append("file", new Blob([new Uint8Array(audioBuffer)]), filename);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const body = await response.text();

  if (!response.ok) {
    let detail = body;
    try {
      detail = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? body;
    } catch {
      // use raw body
    }
    throw new TranscriptionError(`Whisper API error: ${detail}`, response.status);
  }

  const parsed = JSON.parse(body) as { text: string };
  return parsed.text.trim();
}
