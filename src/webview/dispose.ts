const intervals = new Map<string, ReturnType<typeof setInterval>>();
const timeouts = new Map<string, ReturnType<typeof setTimeout>>();
const cleanups = new Map<string, () => void>();

export function registerInterval(id: string, handle: ReturnType<typeof setInterval>): void {
  const prev = intervals.get(id);
  if (prev !== undefined) clearInterval(prev);
  intervals.set(id, handle);
}

export function registerTimeout(id: string, handle: ReturnType<typeof setTimeout>): void {
  const prev = timeouts.get(id);
  if (prev !== undefined) clearTimeout(prev);
  timeouts.set(id, handle);
}

export function registerCleanup(id: string, fn: () => void): void {
  cleanups.set(id, fn);
}

export function disposeAll(): void {
  for (const handle of intervals.values()) clearInterval(handle);
  intervals.clear();
  for (const handle of timeouts.values()) clearTimeout(handle);
  timeouts.clear();
  for (const fn of cleanups.values()) fn();
  cleanups.clear();
}
