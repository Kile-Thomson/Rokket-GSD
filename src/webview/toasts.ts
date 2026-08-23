// ============================================================
// Toasts — brief auto-dismissing feedback notifications
// ============================================================

import { TOAST_DEFAULT_DURATION_MS, CSS_ANIMATION_SETTLE_MS } from "../shared/constants";
import { registerTimeout } from "./dispose";

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

  // Rotate over a small id pool so the dispose registry doesn't grow unboundedly;
  // 8 slots comfortably exceeds the number of simultaneously visible toasts.
  const id = `toast-${toastSeq}`;
  toastSeq = (toastSeq + 1) % 8;
  registerTimeout(`${id}-dismiss`, setTimeout(() => {
    toast.classList.remove("visible");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    // Fallback removal if transitionend doesn't fire
    registerTimeout(`${id}-remove`, setTimeout(() => toast.remove(), CSS_ANIMATION_SETTLE_MS));
  }, duration));
}
