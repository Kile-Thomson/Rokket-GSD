// ============================================================
// File & Image handling — paste, drop, attachments
// ============================================================

import { escapeHtml } from "./helpers";
import { state } from "./state";

// ============================================================
// Dependencies — set via init()
// ============================================================

let vscode: { postMessage(msg: unknown): void };
let imagePreview: HTMLElement;
let sendMessageFn: () => void;

export interface FileHandlingDeps {
  root: HTMLElement;
  imagePreview: HTMLElement;
  promptInput: HTMLTextAreaElement;
  vscode: { postMessage(msg: unknown): void };
  onSendMessage: () => void;
}

export function init(deps: FileHandlingDeps): void {
  vscode = deps.vscode;
  imagePreview = deps.imagePreview;
  sendMessageFn = deps.onSendMessage;

  // Paste handler
  document.addEventListener("paste", (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    let handled = false;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) {
          handleFiles([file]);
          handled = true;
        }
      }
    }
    if (handled) e.preventDefault();
  });

  // Drag & drop
  const inputArea = deps.root.querySelector(".gsd-input-area")!;
  inputArea.addEventListener("dragover", (e: Event) => {
    e.preventDefault();
    (e as DragEvent).dataTransfer!.dropEffect = "copy";
    inputArea.classList.add("drag-over");
  });
  inputArea.addEventListener("dragleave", () => inputArea.classList.remove("drag-over"));
  inputArea.addEventListener("drop", (e: Event) => {
    e.preventDefault();
    (inputArea as HTMLElement).classList.remove("drag-over");
    const dt = (e as DragEvent).dataTransfer;
    if (!dt) return;

    // Check for file URIs (VS Code explorer drops, OS file manager drops)
    const uriList = dt.getData("text/uri-list");
    if (uriList) {
      const paths = parseDroppedUris(uriList);
      if (paths.length > 0) {
        insertDroppedPaths(paths);
        return;
      }
    }

    // Check for plain text paths (some sources use text/plain)
    const plainText = dt.getData("text/plain");
    if (plainText && !dt.files.length) {
      // Heuristic: looks like file path(s) — absolute paths or backslash paths
      const lines = plainText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const looksLikePaths = lines.every(l =>
        /^[A-Z]:\\/.test(l) || l.startsWith("/") || l.startsWith("~")
      );
      if (looksLikePaths) {
        insertDroppedPaths(lines);
        return;
      }
    }

    // Fall through to image handling
    if (dt.files.length) handleFiles(dt.files);
  });
}

// ============================================================
// File handling functions
// ============================================================

export function handleFiles(files: FileList | File[]): void {
  for (const file of Array.from(files)) {
    if (file.type.startsWith("image/")) {
      // Images → inline preview + base64 attachment
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        state.images.push({ type: "image", data: base64, mimeType: file.type });
        renderImagePreviews();
      };
      reader.readAsDataURL(file);
    } else {
      // Non-image files (PDFs, docs, etc.) → save to temp, insert path
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        vscode.postMessage({
          type: "save_temp_file",
          name: file.name,
          data: base64,
          mimeType: file.type,
        });
      };
      reader.readAsDataURL(file);
    }
  }
}

/** Parse file:// URIs from a text/uri-list drop payload into local paths */
export function parseDroppedUris(uriList: string): string[] {
  const paths: string[] = [];
  for (const line of uriList.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("file://")) {
      try {
        // file:///C:/foo or file:///home/user/foo
        const url = new URL(trimmed);
        let fsPath = decodeURIComponent(url.pathname);
        // On Windows, pathname is /C:/foo — strip leading slash
        if (/^\/[A-Za-z]:\//.test(fsPath)) {
          fsPath = fsPath.slice(1);
        }
        paths.push(fsPath);
      } catch {
        // Malformed URI — skip
      }
    }
  }
  return paths;
}

/** Add file paths as file attachment chips */
export function addFileAttachments(paths: string[], autoSend = false): void {
  for (const p of paths) {
    const normalized = p.replace(/\\/g, "/");
    const parts = normalized.split("/");
    const name = parts[parts.length - 1] || p;
    const extMatch = name.match(/\.([^.]+)$/);
    const extension = extMatch ? extMatch[1].toLowerCase() : "";
    // Avoid duplicates
    if (!state.files.some(f => f.path === p)) {
      state.files.push({ type: "file", path: p, name, extension });
    }
  }
  renderFileChips();

  // Check read access
  vscode.postMessage({ type: "check_file_access", paths });

  if (autoSend) {
    sendMessageFn();
  }
}

// Note: insertDroppedPaths is referenced in the drop handler but was not defined
// in the original code. It should probably be addFileAttachments.
function insertDroppedPaths(paths: string[]): void {
  addFileAttachments(paths);
}

export function getFileIcon(ext: string): string {
  const icons: Record<string, string> = {
    pdf: "📄", doc: "📝", docx: "📝", txt: "📝", md: "📝",
    xls: "📊", xlsx: "📊", csv: "📊",
    ppt: "📽️", pptx: "📽️",
    jpg: "🖼️", jpeg: "🖼️", png: "🖼️", gif: "🖼️", svg: "🖼️", webp: "🖼️",
    mp4: "🎬", mov: "🎬", avi: "🎬", mkv: "🎬",
    mp3: "🎵", wav: "🎵", flac: "🎵",
    zip: "📦", tar: "📦", gz: "📦", rar: "📦", "7z": "📦",
    js: "⚡", ts: "⚡", jsx: "⚡", tsx: "⚡",
    py: "🐍", rb: "💎", go: "🔷", rs: "🦀",
    html: "🌐", css: "🎨", scss: "🎨",
    json: "📋", yaml: "📋", yml: "📋", toml: "📋", xml: "📋",
    sh: "⚙️", bash: "⚙️", ps1: "⚙️", cmd: "⚙️", bat: "⚙️",
    sql: "🗃️", db: "🗃️",
    env: "🔒", key: "🔒", pem: "🔒",
  };
  return icons[ext] || "📎";
}

export function renderFileChips(): void {
  const container = document.getElementById("fileChips")!;
  if (state.files.length === 0) {
    container.style.display = "none";
    container.innerHTML = "";
    return;
  }
  container.style.display = "flex";
  container.innerHTML = state.files.map((f, i) => `
    <div class="gsd-file-chip" title="${escapeHtml(f.path)}">
      <span class="gsd-file-chip-icon">${getFileIcon(f.extension)}</span>
      <span class="gsd-file-chip-name">${escapeHtml(f.name)}</span>
      <button class="gsd-file-chip-remove" data-idx="${i}">×</button>
    </div>
  `).join("");

  container.querySelectorAll(".gsd-file-chip-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt((btn as HTMLElement).dataset.idx!);
      state.files.splice(idx, 1);
      renderFileChips();
    });
  });
}

export function renderImagePreviews(): void {
  if (state.images.length === 0) {
    imagePreview.style.display = "none";
    imagePreview.innerHTML = "";
    return;
  }
  imagePreview.style.display = "flex";
  imagePreview.innerHTML = state.images.map((img, i) => `
    <div class="gsd-image-thumb">
      <img src="data:${img.mimeType};base64,${img.data}" alt="Attached" />
      <button class="gsd-image-remove" data-idx="${i}">×</button>
    </div>
  `).join("");

  imagePreview.querySelectorAll(".gsd-image-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt((btn as HTMLElement).dataset.idx!);
      state.images.splice(idx, 1);
      renderImagePreviews();
    });
  });
}
