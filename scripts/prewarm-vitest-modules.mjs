// Pre-load esbuild + jsdom before vitest starts so their first-touch cost
// happens outside vitest's worker-startup window.
//
// This script does not read, modify, or configure any antivirus, Defender, or OS
// setting. It only imports two dev dependencies vitest is about to load anyway,
// a moment earlier, then exits.
//
// Why it exists: on Windows with Defender real-time protection on, a cold scan
// cache (fresh definitions or a reboot) makes the OS scanner serially scan
// esbuild.exe (~11MB) and the jsdom module tree the first time they're touched.
// When that first touch happens inside vitest, the scan lands within vitest's
// hardcoded 60s worker-response window and trips "[vitest-pool-runner]: Timeout
// waiting for worker to respond" (the timeout is a bare constant in vitest 4.x
// with no config or env override, so it can't be bumped).
//
// Importing the same modules here - before `vitest run` - moves that first-touch
// cost out of the timed window, so the worker starts fast. Warm caches make this a
// few-ms no-op, and it's harmless on non-Windows / CI. It must never fail the test run.
async function prewarm() {
  try {
    const esbuild = await import("esbuild");
    // Forces the esbuild service binary (esbuild.exe) to spawn and be loaded.
    await esbuild.transform("const warm = 1;", { loader: "ts" });
    await esbuild.stop?.();
  } catch {
    // esbuild missing or failed - not our problem to surface here.
  }
  try {
    // Forces the jsdom module tree to be read.
    await import("jsdom");
  } catch {
    // jsdom missing or failed - the test run will report it far more clearly.
  }
}

prewarm().finally(() => process.exit(0));
