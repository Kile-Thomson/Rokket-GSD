// ============================================================
// Toasts — brief auto-dismissing feedback notifications
// ============================================================

import { TOAST_DEFAULT_DURATION_MS, CSS_ANIMATION_SETTLE_MS } from "../shared/constants";

let container: HTMLElement;

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

  setTimeout(() => {
    toast.classList.remove("visible");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    // Fallback removal if transitionend doesn't fire
    setTimeout(() => toast.remove(), CSS_ANIMATION_SETTLE_MS);
  }, duration);
}
