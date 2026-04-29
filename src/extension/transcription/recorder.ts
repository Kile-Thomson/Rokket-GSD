import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export class AudioRecorder {
  private process: ChildProcess | null = null;
  private outputPath: string | null = null;
  private _isRecording = false;

  get isRecording(): boolean {
    return this._isRecording;
  }

  async start(): Promise<void> {
    if (this._isRecording) return;

    const tmpDir = os.tmpdir();
    const platform = os.platform();

    if (platform === "win32") {
      await this.startWindows(tmpDir);
    } else if (platform === "darwin") {
      await this.startMacOS(tmpDir);
    } else {
      await this.startLinux(tmpDir);
    }

    this._isRecording = true;
  }

  async stop(): Promise<Buffer> {
    if (!this._isRecording || !this.outputPath) {
      throw new Error("Not recording");
    }

    const platform = os.platform();
    if (platform === "win32") {
      await this.stopWindows();
    } else {
      this.process?.kill("SIGINT");
      await waitForExit(this.process);
    }

    this._isRecording = false;
    this.process = null;

    const outputPath = this.outputPath;
    this.outputPath = null;

    // Wait briefly for file to be flushed
    await new Promise((r) => setTimeout(r, 200));

    if (!fs.existsSync(outputPath)) {
      throw new Error("Recording file was not created");
    }

    const audioBuffer = await fs.promises.readFile(outputPath);
    await fs.promises.unlink(outputPath).catch(() => {});
    return audioBuffer;
  }

  cancel(): void {
    this._isRecording = false;

    if (this.process) {
      if (os.platform() === "win32") {
        this.process.stdin?.write("CANCEL\n");
        setTimeout(() => this.process?.kill(), 2000);
      } else {
        this.process.kill("SIGINT");
      }
      this.process = null;
    }

    if (this.outputPath) {
      fs.promises.unlink(this.outputPath).catch(() => {});
      this.outputPath = null;
    }
  }

  private async startWindows(tmpDir: string): Promise<void> {
    this.outputPath = path.join(tmpDir, `gsd-voice-${Date.now()}.wav`);
    const outEscaped = this.outputPath.replace(/"/g, '""');

    // Single PowerShell process: starts recording, waits for "STOP" on stdin, then saves
    const script = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class MCI {
  [DllImport("winmm.dll", CharSet = CharSet.Unicode)]
  public static extern int mciSendString(string cmd, StringBuilder ret, int retLen, IntPtr callback);
  public static void Send(string cmd) {
    var sb = new StringBuilder(256);
    int err = mciSendString(cmd, sb, 256, IntPtr.Zero);
    if (err != 0) { throw new Exception("MCI error " + err + " for: " + cmd); }
  }
}
"@
try {
  [MCI]::Send("open new type waveaudio alias gsdmic")
  [MCI]::Send("record gsdmic")
  [Console]::Out.WriteLine("RECORDING")
  [Console]::Out.Flush()
  $line = [Console]::In.ReadLine()
  [MCI]::Send("stop gsdmic")
  if ($line -eq "STOP") {
    [MCI]::Send('save gsdmic "${outEscaped}"')
    [Console]::Out.WriteLine("SAVED")
    [Console]::Out.Flush()
  }
  [MCI]::Send("close gsdmic")
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`;

    this.process = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Recording start timed out")), 8000);
      let stderr = "";
      this.process!.stdout!.on("data", (data: Buffer) => {
        if (data.toString().includes("RECORDING")) {
          clearTimeout(timeout);
          resolve();
        }
      });
      this.process!.stderr!.on("data", (data: Buffer) => { stderr += data.toString(); });
      this.process!.on("close", (code) => {
        if (code !== 0 && !this._isRecording) {
          clearTimeout(timeout);
          reject(new Error(stderr.trim() || `Recording process exited with code ${code}`));
        }
      });
      this.process!.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  private async stopWindows(): Promise<void> {
    if (!this.process) return;

    this.process.stdin?.write("STOP\n");

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.process?.kill();
        reject(new Error("Save timed out"));
      }, 10000);
      this.process!.stdout!.on("data", (data: Buffer) => {
        if (data.toString().includes("SAVED")) {
          clearTimeout(timeout);
          resolve();
        }
      });
      this.process!.on("close", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  private async startMacOS(tmpDir: string): Promise<void> {
    this.outputPath = path.join(tmpDir, `gsd-voice-${Date.now()}.wav`);

    const recCmd = await findCommand(["rec", "sox", "ffmpeg"]);
    if (!recCmd) {
      throw new Error("No audio recorder found. Install SoX (brew install sox) or FFmpeg.");
    }

    if (recCmd === "rec" || recCmd === "sox") {
      const args = recCmd === "rec"
        ? ["-q", this.outputPath, "rate", "16000", "channels", "1"]
        : ["-d", "-q", this.outputPath, "rate", "16000", "channels", "1"];
      this.process = spawn(recCmd, args, { stdio: "pipe" });
    } else {
      this.process = spawn("ffmpeg", ["-f", "avfoundation", "-i", ":default", "-ar", "16000", "-ac", "1", "-y", this.outputPath], { stdio: "pipe" });
    }

    this.process.on("error", () => { this._isRecording = false; });
  }

  private async startLinux(tmpDir: string): Promise<void> {
    this.outputPath = path.join(tmpDir, `gsd-voice-${Date.now()}.wav`);

    const recCmd = await findCommand(["arecord", "rec", "ffmpeg"]);
    if (!recCmd) {
      throw new Error("No audio recorder found. Install arecord (alsa-utils), SoX, or FFmpeg.");
    }

    if (recCmd === "arecord") {
      this.process = spawn("arecord", ["-f", "S16_LE", "-r", "16000", "-c", "1", this.outputPath], { stdio: "pipe" });
    } else if (recCmd === "rec") {
      this.process = spawn("rec", ["-q", this.outputPath, "rate", "16000", "channels", "1"], { stdio: "pipe" });
    } else {
      this.process = spawn("ffmpeg", ["-f", "pulse", "-i", "default", "-ar", "16000", "-ac", "1", "-y", this.outputPath], { stdio: "pipe" });
    }

    this.process.on("error", () => { this._isRecording = false; });
  }
}

function waitForExit(proc: ChildProcess | null): Promise<void> {
  if (!proc) return Promise.resolve();
  return new Promise((resolve) => {
    proc.on("close", () => resolve());
    setTimeout(() => { proc.kill("SIGKILL"); resolve(); }, 5000);
  });
}

async function findCommand(candidates: string[]): Promise<string | null> {
  const { execFile } = await import("child_process");
  const which = os.platform() === "win32" ? "where" : "which";
  for (const cmd of candidates) {
    try {
      await new Promise<void>((resolve, reject) => {
        execFile(which, [cmd], { timeout: 5000, windowsHide: true }, (err) => {
          if (err) reject(err); else resolve();
        });
      });
      return cmd;
    } catch {
      continue;
    }
  }
  return null;
}
