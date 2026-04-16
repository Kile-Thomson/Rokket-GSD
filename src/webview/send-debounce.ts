import { SEND_DEBOUNCE_MS } from "../shared/constants";
export { SEND_DEBOUNCE_MS };

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
