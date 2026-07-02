// Warm the antivirus scan cache for esbuild + jsdom before vitest starts.
//
// On Windows with Defender real-time protection on, a cold scan cache (fresh
// definitions or a reboot) makes Defender serially scan esbuild.exe (~11MB) and
// the jsdom module tree the first time they're touched. Inside vitest that scan
// lands within the hardcoded 60s worker-response window and trips
// "[vitest-pool-runner]: Timeout waiting for worker to respond" (the timeout is a
// bare constant in vitest 4.x with no config or env override, so it can't be bumped).
//
// Touching the same binaries here - before `vitest run` - moves the scan out of the
// timed window, so the worker starts fast. Warm caches make this a few-ms no-op, and
// it's harmless on non-Windows / CI. It must never fail the test run.
async function warm() {
  try {
    const esbuild = await import("esbuild");
    // Forces the esbuild service binary (esbuild.exe) to spawn and be scanned.
    await esbuild.transform("const warm = 1;", { loader: "ts" });
    await esbuild.stop?.();
  } catch {
    // esbuild missing or failed - not our problem to surface here.
  }
  try {
    // Forces the jsdom module tree to be read and scanned.
    await import("jsdom");
  } catch {
    // jsdom missing or failed - the test run will report it far more clearly.
  }
}

warm().finally(() => process.exit(0));
