// ============================================================
// Toasts — brief auto-dismissing feedback notifications
// ============================================================

import { TOAST_DEFAULT_DURATION_MS, CSS_ANIMATION_SETTLE_MS } from "../shared/constants";
import { registerTimeout, unregisterTimeout } from "./dispose";

let container: HTMLElement;
let toastSeq = 0;

export function init(el: HTMLElement): void {
  container = el;
}

export function show(message: string, duration = TOAST_DEFAULT_DURATION_MS): void {
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = "gsd-toast";
  toast.textContent = message;
  container.appendChild(toast);

  // Trigger enter animation
  requestAnimationFrame(() => {
    toast.classList.add("visible");
  });

  // Unique id per toast so one toast's timers can never cancel another's; each
  // entry unregisters itself on fire so the registry doesn't grow unboundedly.
  const id = `toast-${toastSeq++}`;
  registerTimeout(`${id}-dismiss`, setTimeout(() => {
    unregisterTimeout(`${id}-dismiss`);
    toast.classList.remove("visible");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    // Fallback removal if transitionend doesn't fire
    registerTimeout(`${id}-remove`, setTimeout(() => {
      unregisterTimeout(`${id}-remove`);
      toast.remove();
    }, CSS_ANIMATION_SETTLE_MS));
  }, duration));
}
