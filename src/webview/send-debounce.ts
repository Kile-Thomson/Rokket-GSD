export const SEND_DEBOUNCE_MS = 300;

let lastSendTime = 0;

export function shouldDebounce(): boolean {
  const now = Date.now();
  if (now - lastSendTime < SEND_DEBOUNCE_MS) return true;
  lastSendTime = now;
  return false;
}

export function _testResetDebounce(): void {
  lastSendTime = 0;
}
