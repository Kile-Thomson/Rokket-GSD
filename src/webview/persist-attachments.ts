import { state } from "./state";

let vscodePersist: { setState(state: unknown): void; getState(): unknown } | null = null;

export function initPersistAttachments(vscode: { setState(state: unknown): void; getState(): unknown }): void {
  vscodePersist = vscode;
}

export function persistAttachments(): void {
  if (!vscodePersist) return;
  vscodePersist.setState({ images: state.images, files: state.files });
}

export function rehydrateAttachments(): { hadImages: boolean; hadFiles: boolean } {
  if (!vscodePersist) return { hadImages: false, hadFiles: false };
  const restored = vscodePersist.getState() as { images?: unknown[]; files?: unknown[] } | null;
  let hadImages = false;
  let hadFiles = false;
  if (restored?.images && Array.isArray(restored.images) && restored.images.length > 0) {
    state.images = restored.images as typeof state.images;
    hadImages = true;
  }
  if (restored?.files && Array.isArray(restored.files) && restored.files.length > 0) {
    state.files = restored.files as typeof state.files;
    hadFiles = true;
  }
  return { hadImages, hadFiles };
}

export function _testReset(): void {
  vscodePersist = null;
}
