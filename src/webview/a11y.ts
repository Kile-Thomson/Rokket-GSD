// ============================================================
// Accessibility Utilities — shared focus management for overlays
// ============================================================

/**
 * Focus trap helper: cycles Tab/Shift+Tab within a container.
 * Returns a keydown handler to attach to the container.
 *
 * Usage:
 *   const trap = createFocusTrap(container);
 *   container.addEventListener("keydown", trap);
 *   // ... on close:
 *   container.removeEventListener("keydown", trap);
 */
export function createFocusTrap(container: HTMLElement): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const focusable = container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
}

/**
 * Save the currently focused element before opening an overlay.
 * Returns the element (or null) — pass it to `restoreFocus()` on close.
 */
export function saveFocus(): HTMLElement | null {
  return document.activeElement as HTMLElement | null;
}

/**
 * Restore focus to a previously saved element after closing an overlay.
 */
export function restoreFocus(el: HTMLElement | null): void {
  if (el && typeof el.focus === "function") {
    el.focus();
  }
}
