// ============================================================
// Toasts — brief auto-dismissing feedback notifications
// ============================================================

let container: HTMLElement;

export function init(el: HTMLElement): void {
  container = el;
}

export function show(message: string, duration = 2500): void {
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
    setTimeout(() => toast.remove(), 300);
  }, duration);
}
