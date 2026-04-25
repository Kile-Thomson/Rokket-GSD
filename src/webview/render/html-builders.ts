import {
  type ChatEntry,
  type AssistantTurn,
  type ToolCallState,
  type TurnSegment,
} from "../state";

import {
  escapeHtml,
  escapeAttr,
  formatDuration,
  formatRelativeTime,
  formatTokens,
  getToolCategory,
  getToolIcon,
  getToolKeyArg,
  formatToolResult,
  truncateArg,
  buildUsagePills,
  parseAgentUsage,
  renderMarkdown,
} from "../helpers";

import {
  groupConsecutiveTools,
  buildGroupSummaryLabel,
} from "../tool-grouping";

import { MAX_OUTPUT_LEN } from "../../shared/constants";

export function createEntryElement(entry: ChatEntry): HTMLElement {
  const el = document.createElement("div");
  el.className = `gsd-entry gsd-entry-${entry.type}`;
  el.dataset.entryId = entry.id;
  el.setAttribute("role", "listitem");
  const labelMap: Record<string, string> = { user: "User message", assistant: "Assistant response", system: "System message" };
  el.setAttribute("aria-label", labelMap[entry.type] || entry.type);

  if (entry.type === "user") {
    el.innerHTML = buildUserHtml(entry);
    if (entry.isSteer) el.dataset.steer = "true";
  } else if (entry.type === "assistant" && entry.turn) {
    if (entry.turn.isStaleEcho) {
      el.classList.add("gsd-stale-echo");
      el.innerHTML = buildStaleEchoHtml(entry.turn);
    } else {
      el.innerHTML = buildTurnHtml(entry.turn);
    }
  } else if (entry.type === "system") {
    el.innerHTML = buildSystemHtml(entry);
  }

  return el;
}

export function buildTimestampHtml(ts: number): string {
  if (!ts) return "";
  const abs = new Date(ts).toLocaleString();
  const rel = formatRelativeTime(ts);
  return `<span class="gsd-timestamp" data-ts="${ts}" title="${escapeAttr(abs)}">${escapeHtml(rel)}</span>`;
}

function getFileIcon(ext: string): string {
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

function buildUserHtml(entry: ChatEntry): string {
  let html = `<div class="gsd-user-bubble">`;
  if (entry.files?.length) {
    html += `<div class="gsd-user-files">${entry.files.map((f) =>
      `<div class="gsd-file-chip sent" title="${escapeAttr(f.path)}">
        <span class="gsd-file-chip-icon">${getFileIcon(f.extension)}</span>
        <span class="gsd-file-chip-name">${escapeHtml(f.name)}</span>
      </div>`
    ).join("")}</div>`;
  }
  if (entry.images?.length) {
    html += `<div class="gsd-user-images">${entry.images.map((img) =>
      `<img src="data:${img.mimeType};base64,${img.data}" class="gsd-user-img" alt="Image" />`
    ).join("")}</div>`;
  }
  if (entry.text) {
    html += escapeHtml(entry.text);
  }
  html += `</div>`;
  html += buildTimestampHtml(entry.timestamp);
  return html;
}

export function buildStaleEchoHtml(turn: AssistantTurn): string {
  const textContent = turn.segments
    .filter(s => s.type === "text")
    .map(s => s.chunks.join(""))
    .join(" ")
    .trim();
  const preview = textContent.length > 80 ? textContent.slice(0, 77) + "…" : textContent;
  const panelId = `stale-echo-${turn.id}`;
  return `<div class="gsd-stale-echo-bar" role="button" tabindex="0" aria-expanded="false" aria-controls="${escapeAttr(panelId)}" aria-label="Expand background notification echo" title="Background job notification — click to expand">
    <span class="gsd-stale-echo-icon">↩</span>
    <span class="gsd-stale-echo-text">${escapeHtml(preview)}</span>
  </div>
  <div class="gsd-stale-echo-full" id="${escapeAttr(panelId)}" hidden>${buildTurnHtml(turn)}</div>`;
}

function buildTurnHtml(turn: AssistantTurn): string {
  const parts: string[] = [];
  const grouped = groupConsecutiveTools(turn.segments, turn.toolCalls);

  if (grouped.length !== turn.segments.length) {
    const groupCount = grouped.filter(g => g.type === "group").length;
    if (groupCount > 0) {
      console.debug(`[gsd] Tool grouping: ${groupCount} group(s) from ${turn.segments.length} segments`);
    }
  }

  let skippedCount = 0;

  for (const item of grouped) {
    if (item.type === "group") {
      if (skippedCount > 0) {
        parts.push(buildSkippedGroupHtml(skippedCount));
        skippedCount = 0;
      }
      parts.push(buildToolGroupHtml(item.segments, item.toolNames, turn.toolCalls));
    } else {
      const seg = item.segment;
      if (seg.type === "tool") {
        const tc = turn.toolCalls.get(seg.toolCallId);
        if (tc?.isSkipped) {
          skippedCount++;
          continue;
        }
      }
      if (skippedCount > 0) {
        parts.push(buildSkippedGroupHtml(skippedCount));
        skippedCount = 0;
      }
      parts.push(buildSegmentHtml(item.segment, turn.toolCalls));
    }
  }
  if (skippedCount > 0) {
    parts.push(buildSkippedGroupHtml(skippedCount));
  }

  if (!turn.isComplete) {
    const hasAnyContent = turn.segments.length > 0;
    const hasRunningTool = Array.from(turn.toolCalls.values()).some((t) => t.isRunning);
    if (!hasRunningTool && !hasAnyContent) {
      parts.push(`<div class="gsd-thinking-dots"><span></span><span></span><span></span></div>`);
    }
  }

  if (turn.isComplete) {
    const textContent = turn.segments
      .filter(s => s.type === "text")
      .map(s => s.chunks.join(""))
      .join("\n\n");
    if (textContent) {
      parts.push(`<div class="gsd-turn-actions">`);
      parts.push(`<button class="gsd-copy-response-btn" data-copy-text="${escapeAttr(textContent)}" title="Copy response" aria-label="Copy response">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 4h8v8H4V4zm1 1v6h6V5H5zm-3-3h8v1H3v7H2V2h8z"/></svg>
        Copy
      </button>`);
      if (turn.timestamp) {
        parts.push(buildTimestampHtml(turn.timestamp));
      }
      parts.push(`</div>`);
    } else if (turn.timestamp) {
      parts.push(buildTimestampHtml(turn.timestamp));
    }
  }

  return parts.join("");
}

function buildSkippedGroupHtml(count: number): string {
  const label = count === 1
    ? "1 tool call skipped — agent redirected"
    : `${count} tool calls skipped — agent redirected`;
  return `<div class="gsd-skipped-group">
    <span class="gsd-skipped-icon">⏭</span>
    <span class="gsd-skipped-label">${escapeHtml(label)}</span>
  </div>`;
}

function buildSegmentHtml(seg: TurnSegment, toolCalls: Map<string, ToolCallState>): string {
  if (seg.type === "thinking") {
    const thinkingText = seg.chunks.join("");
    if (!thinkingText) return "";
    const lineCount = thinkingText.split("\n").length;
    return `<details class="gsd-thinking-block">
      <summary class="gsd-thinking-header">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 13A6 6 0 118 2a6 6 0 010 12zm-.5-3h1v1h-1v-1zm.5-7a2.5 2.5 0 00-2.5 2.5h1A1.5 1.5 0 018 5a1.5 1.5 0 011.5 1.5c0 .44-.18.84-.46 1.13l-.64.66A2.49 2.49 0 007.5 10h1c0-.52.21-1 .57-1.35l.64-.66A2.49 2.49 0 0010.5 6.5 2.5 2.5 0 008 4z"/></svg>
        <span class="gsd-thinking-label">Thinking</span>
        <span class="gsd-thinking-lines">${lineCount} line${lineCount !== 1 ? "s" : ""}</span>
      </summary>
      <div class="gsd-thinking-content">${escapeHtml(thinkingText)}</div>
    </details>`;
  } else if (seg.type === "text") {
    const text = seg.chunks.join("");
    if (!text) return "";
    return `<div class="gsd-assistant-text">${renderMarkdown(text)}</div>`;
  } else if (seg.type === "tool") {
    const tc = toolCalls.get(seg.toolCallId);
    if (!tc) return "";
    try {
      return `<div class="gsd-tool-segment">${buildToolCallHtml(tc)}</div>`;
    } catch (err) {
      console.error("Error rendering tool call:", tc.name, err);
      return `<div class="gsd-tool-segment"><div class="gsd-tool-block error collapsed" data-tool-id="${escapeAttr(tc.id)}">
        <div class="gsd-tool-header" role="button" tabindex="0" aria-label="Toggle ${escapeAttr(tc.name)} details" aria-expanded="false">
          <span class="gsd-tool-icon error">✗</span>
          <span class="gsd-tool-name">${escapeHtml(tc.name)}</span>
          <span class="gsd-tool-arg">render error</span>
        </div>
      </div></div>`;
    }
  } else if (seg.type === "server_tool") {
    const displayName = seg.name === "web_search" ? "Web Search" : seg.name;
    const icon = seg.name === "web_search" ? "🔍" : "⚡";
    const inputSummary = seg.input && typeof seg.input === "object" && "query" in (seg.input as Record<string, unknown>)
      ? String((seg.input as Record<string, unknown>).query ?? "")
      : "";
    const stateClass = seg.isComplete ? "done" : "running";
    const statusHtml = seg.isComplete
      ? `<span class="gsd-server-tool-check">✓</span>`
      : `<span class="gsd-tool-spinner"></span>`;
    let countHtml = "";
    if (seg.isComplete && Array.isArray(seg.results)) {
      const searchResults = (seg.results as unknown[]).filter(
        (r: unknown) => r && typeof r === "object" && "type" in (r as Record<string, unknown>) && (r as Record<string, unknown>).type === "web_search_result"
      );
      if (searchResults.length > 0) {
        countHtml = `<span class="gsd-server-tool-count">${searchResults.length} result${searchResults.length !== 1 ? "s" : ""}</span>`;
      }
    }
    return `<div class="gsd-server-tool-segment"><div class="gsd-server-tool-card ${stateClass}">` +
      `<span class="gsd-server-tool-icon">${icon}</span>` +
      `<span class="gsd-server-tool-name">${escapeHtml(displayName)}</span>` +
      (inputSummary ? `<span class="gsd-server-tool-query">${escapeHtml(inputSummary)}</span>` : "") +
      statusHtml +
      countHtml +
      `</div></div>`;
  }
  return "";
}

function buildToolGroupHtml(
  segments: TurnSegment[],
  toolNames: string[],
  toolCalls: Map<string, ToolCallState>,
): string {
  const label = buildGroupSummaryLabel(toolNames);
  let inner = "";
  for (const seg of segments) {
    if (seg.type === "tool") {
      const tc = toolCalls.get(seg.toolCallId);
      if (tc) {
        try {
          inner += `<div class="gsd-tool-segment">${buildToolCallHtml(tc)}</div>`;
        } catch (err) {
          console.error("Error rendering grouped tool call:", tc.name, err);
        }
      }
    }
  }

  return `<details class="gsd-tool-group" data-tool-group="${toolNames.length}">
    <summary class="gsd-tool-group-header" role="button" tabindex="0" aria-label="Toggle ${escapeAttr(label)}" aria-expanded="false">
      <span class="gsd-tool-group-icon">
        <span class="gsd-tool-icon success">✓</span>
      </span>
      <span class="gsd-tool-group-label">${escapeHtml(label)}</span>
      <span class="gsd-tool-group-count">${toolNames.length}</span>
      <span class="gsd-tool-chevron">▸</span>
    </summary>
    <div class="gsd-tool-group-content">${inner}</div>
  </details>`;
}

export function patchToolBlockElement(el: HTMLElement, tc: ToolCallState): void {
  const block = el.classList.contains("gsd-tool-block")
    ? el
    : el.querySelector<HTMLElement>(".gsd-tool-block");
  if (!block) {
    el.innerHTML = buildToolCallHtml(tc);
    return;
  }

  const stateClass = tc.isRunning ? "running" : tc.isSkipped ? "skipped" : tc.isError ? "error" : "done";
  const category = getToolCategory(tc.name);
  const isAgentPatch = category === "agent";
  const agentUsageParsedEarly = isAgentPatch && tc.resultText ? parseAgentUsage(tc.resultText) : null;
  const resultForCollapse = agentUsageParsedEarly ? agentUsageParsedEarly.cleanText : tc.resultText;
  const lines = resultForCollapse ? resultForCollapse.split("\n").length : 0;
  const shouldCollapse = !tc.isRunning && (lines > 5 || tc.isSkipped);

  block.classList.remove("running", "skipped", "error", "done", "collapsed");
  block.classList.add(stateClass);
  if (shouldCollapse) block.classList.add("collapsed");
  if (tc.isParallel) block.classList.add("parallel");

  const header = block.querySelector<HTMLElement>(".gsd-tool-header");
  if (header) {
    header.setAttribute("aria-expanded", shouldCollapse ? "false" : "true");
  }

  const newKeyArg = getToolKeyArg(tc.name, tc.args);
  const argEl = block.querySelector<HTMLElement>(".gsd-tool-arg");
  if (newKeyArg) {
    if (argEl) {
      argEl.textContent = newKeyArg;
    } else {
      const nameEl = block.querySelector<HTMLElement>(".gsd-tool-name");
      if (nameEl) {
        const span = document.createElement("span");
        span.className = "gsd-tool-arg";
        span.textContent = newKeyArg;
        nameEl.insertAdjacentElement("afterend", span);
      }
    }
  }

  const statusIconEl = block.querySelector<HTMLElement>(
    ".gsd-tool-spinner, .gsd-tool-icon"
  );
  if (statusIconEl) {
    const currentlyRunning = statusIconEl.classList.contains("gsd-tool-spinner") ||
      !statusIconEl.classList.contains("gsd-tool-icon");
    if (tc.isRunning && !statusIconEl.classList.contains("gsd-tool-spinner")) {
      const spinner = document.createElement("span");
      spinner.className = "gsd-tool-spinner";
      statusIconEl.replaceWith(spinner);
    } else if (!tc.isRunning && (currentlyRunning || statusIconEl.classList.contains("gsd-tool-spinner"))) {
      const icon = document.createElement("span");
      icon.className = "gsd-tool-icon " + (tc.isSkipped ? "skipped" : tc.isError ? "error" : "success");
      icon.textContent = tc.isSkipped ? "⏭" : tc.isError ? "✗" : "✓";
      statusIconEl.replaceWith(icon);
    } else if (!tc.isRunning) {
      statusIconEl.className = "gsd-tool-icon " + (tc.isSkipped ? "skipped" : tc.isError ? "error" : "success");
      statusIconEl.textContent = tc.isSkipped ? "⏭" : tc.isError ? "✗" : "✓";
    }
  }

  const duration = tc.endTime && tc.startTime
    ? formatDuration(tc.endTime - tc.startTime)
    : tc.isRunning && tc.startTime
      ? formatDuration(Date.now() - tc.startTime)
      : "";
  const durationEl = block.querySelector<HTMLElement>(".gsd-tool-duration");
  if (duration) {
    if (durationEl) {
      durationEl.textContent = duration;
      durationEl.className = `gsd-tool-duration${tc.isRunning ? " elapsed-live" : ""}`;
    } else {
      const right = block.querySelector<HTMLElement>(".gsd-tool-header-right");
      if (right) {
        const span = document.createElement("span");
        span.className = `gsd-tool-duration${tc.isRunning ? " elapsed-live" : ""}`;
        span.textContent = duration;
        const chevron = right.querySelector(".gsd-tool-chevron");
        right.insertBefore(span, chevron ?? null);
      }
    }
  } else if (durationEl) {
    durationEl.remove();
  }

  // Agent meta — update model pill + description when args arrive, usage pills when result arrives
  const isAgentUpdate = isAgentPatch;
  const agentUsageParsed = agentUsageParsedEarly;
  if (isAgentUpdate) {
    const headerEl = block.querySelector<HTMLElement>(".gsd-tool-header");
    if (headerEl && Object.keys(tc.args).length > 0) {
      const model = tc.args.model ? String(tc.args.model)
        : tc.args.subagent_type ? String(tc.args.subagent_type)
        : "inherited";
      const agentDesc = tc.args.description ? String(tc.args.description)
        : tc.args.prompt ? truncateArg(String(tc.args.prompt), 100)
        : "";
      const pills: string[] = [model];
      if (tc.args.run_in_background) pills.push("bg");

      // Update or insert pills inline in header
      const pillsEl = headerEl.querySelector<HTMLElement>(".gsd-agent-meta-pills");
      if (pillsEl) {
        pillsEl.innerHTML = pills.map(p => `<span class="gsd-agent-pill">${escapeHtml(p)}</span>`).join("");
      } else {
        const rightEl = headerEl.querySelector<HTMLElement>(".gsd-tool-header-right");
        if (rightEl) {
          rightEl.insertAdjacentHTML("beforebegin", `<span class="gsd-agent-meta-pills">${pills.map(p => `<span class="gsd-agent-pill">${escapeHtml(p)}</span>`).join("")}</span>`);
        }
      }

      // Update or insert description inline in header
      if (agentDesc) {
        const descEl = headerEl.querySelector<HTMLElement>(".gsd-agent-desc");
        if (descEl) {
          descEl.textContent = agentDesc;
        } else {
          const pillsEl2 = headerEl.querySelector<HTMLElement>(".gsd-agent-meta-pills");
          if (pillsEl2) {
            pillsEl2.insertAdjacentHTML("beforebegin", `<span class="gsd-agent-desc">${escapeHtml(agentDesc)}</span>`);
          } else {
            const rightEl2 = headerEl.querySelector<HTMLElement>(".gsd-tool-header-right");
            if (rightEl2) {
              rightEl2.insertAdjacentHTML("beforebegin", `<span class="gsd-agent-desc">${escapeHtml(agentDesc)}</span>`);
            }
          }
        }
      }
    }

    if (tc.resultText) {
      const existingUsage = block.querySelector<HTMLElement>(".gsd-agent-usage");
      if (agentUsageParsed) {
        const usageHtml = buildUsagePills(agentUsageParsed.usage);
        if (existingUsage) {
          existingUsage.outerHTML = usageHtml;
        } else {
          const headerEl = block.querySelector<HTMLElement>(".gsd-tool-header");
          if (headerEl) {
            headerEl.insertAdjacentHTML("afterend", usageHtml);
          }
        }
      }
    }
  }

  const outputEl = block.querySelector<HTMLElement>(".gsd-tool-output");
  if (tc.resultText) {
    const resultForDisplay = agentUsageParsed ? agentUsageParsed.cleanText : tc.resultText;
    const formattedResult = formatToolResult(tc.name, resultForDisplay, tc.args);
    const maxOutputLen = MAX_OUTPUT_LEN;
    let displayText = formattedResult;
    let truncated = false;
    if (displayText.length > maxOutputLen) {
      displayText = displayText.slice(0, maxOutputLen);
      truncated = true;
    }
    let newOutputHtml = `<pre><code>${escapeHtml(displayText)}</code></pre>`;
    if (truncated) {
      newOutputHtml += `<div class="gsd-tool-output-truncated">… output truncated (${formatTokens(tc.resultText.length)} chars)</div>`;
    }
    if (outputEl) {
      outputEl.className = "gsd-tool-output";
      outputEl.innerHTML = newOutputHtml;
    } else {
      const div = document.createElement("div");
      div.className = "gsd-tool-output";
      div.innerHTML = newOutputHtml;
      block.appendChild(div);
    }
  } else if (tc.isRunning) {
    if (outputEl) {
      outputEl.className = "gsd-tool-output";
      outputEl.innerHTML = `<span class="gsd-tool-output-pending">Running...</span>`;
    } else {
      const div = document.createElement("div");
      div.className = "gsd-tool-output";
      div.innerHTML = `<span class="gsd-tool-output-pending">Running...</span>`;
      block.appendChild(div);
    }
  } else if (outputEl) {
    outputEl.remove();
  }
}

export function patchToolBlock(el: HTMLElement, tc: ToolCallState): void {
  patchToolBlockElement(el, tc);
}

export function buildToolCallHtml(tc: ToolCallState): string {
  const keyArg = getToolKeyArg(tc.name, tc.args);
  const category = getToolCategory(tc.name);
  const toolIcon = getToolIcon(tc.name, category);
  const isAgent = category === "agent";

  const statusIcon = tc.isRunning ? `<span class="gsd-tool-spinner"></span>` :
    tc.isSkipped ? `<span class="gsd-tool-icon skipped">⏭</span>` :
    tc.isError ? `<span class="gsd-tool-icon error">✗</span>` :
    `<span class="gsd-tool-icon success">✓</span>`;

  const duration = tc.endTime && tc.startTime
    ? formatDuration(tc.endTime - tc.startTime)
    : tc.isRunning && tc.startTime
      ? formatDuration(Date.now() - tc.startTime)
      : "";
  const durationHtml = duration
    ? `<span class="gsd-tool-duration${tc.isRunning ? " elapsed-live" : ""}">${duration}</span>`
    : "";

  const stateClass = tc.isRunning ? "running" : tc.isSkipped ? "skipped" : tc.isError ? "error" : "done";
  const parallelClass = tc.isParallel ? " parallel" : "";

  const agentUsageParsed = isAgent && tc.resultText ? parseAgentUsage(tc.resultText) : null;
  const resultForCollapse = agentUsageParsed ? agentUsageParsed.cleanText : tc.resultText;
  const lines = resultForCollapse ? resultForCollapse.split("\n").length : 0;
  const shouldCollapse = !tc.isRunning && (lines > 5 || tc.isSkipped);
  const collapsedClass = shouldCollapse ? "collapsed" : "";

  let outputHtml = "";

  if (tc.resultText) {
    const resultForDisplay = agentUsageParsed ? agentUsageParsed.cleanText : tc.resultText;
    const formattedResult = formatToolResult(tc.name, resultForDisplay, tc.args);
    const maxOutputLen = MAX_OUTPUT_LEN;
    let displayText = formattedResult;
    let truncated = false;
    if (displayText.length > maxOutputLen) {
      displayText = displayText.slice(0, maxOutputLen);
      truncated = true;
    }
    outputHtml = `<div class="gsd-tool-output"><pre><code>${escapeHtml(displayText)}</code></pre>`;
    if (truncated) {
      outputHtml += `<div class="gsd-tool-output-truncated">… output truncated (${formatTokens(tc.resultText.length)} chars)</div>`;
    }
    outputHtml += `</div>`;
  } else if (tc.isRunning) {
    outputHtml = `<div class="gsd-tool-output"><span class="gsd-tool-output-pending">Running...</span></div>`;
  }

  const parallelBadge = tc.isParallel ? `<span class="gsd-tool-parallel-badge" title="Running in parallel">⚡</span>` : "";

  // Agent-specific: inline pills in header, description below
  let agentMetaHtml = "";
  let agentUsageHtml = "";
  let agentPillsHtml = "";
  if (isAgent) {
    const model = tc.args.model ? String(tc.args.model)
      : tc.args.subagent_type ? String(tc.args.subagent_type)
      : "inherited";
    const agentDesc = tc.args.description ? String(tc.args.description)
      : tc.args.prompt ? truncateArg(String(tc.args.prompt), 100)
      : "";
    const pills: string[] = [model];
    if (tc.args.run_in_background) pills.push("bg");
    agentPillsHtml = `<span class="gsd-agent-meta-pills">${pills.map(p => `<span class="gsd-agent-pill">${escapeHtml(p)}</span>`).join("")}</span>`;
    agentMetaHtml = agentDesc ? `<span class="gsd-agent-desc">${escapeHtml(agentDesc)}</span>` : "";

    if (agentUsageParsed) {
      agentUsageHtml = buildUsagePills(agentUsageParsed.usage);
    }
  }

  const isCollapsed = collapsedClass === "collapsed";
  const displayName = isAgent ? "Agent" : tc.name;
  return `<div class="gsd-tool-block ${stateClass}${parallelClass} ${collapsedClass} cat-${category}" data-tool-id="${escapeAttr(tc.id)}">
    <div class="gsd-tool-header" role="button" tabindex="0" aria-label="Toggle ${escapeAttr(tc.name)} details" aria-expanded="${isCollapsed ? "false" : "true"}">
      ${statusIcon}
      <span class="gsd-tool-cat-icon">${toolIcon}</span>
      <span class="gsd-tool-name">${escapeHtml(displayName)}</span>
      ${keyArg ? `<span class="gsd-tool-arg">${escapeHtml(keyArg)}</span>` : ""}
      ${agentMetaHtml}
      ${agentPillsHtml}
      <span class="gsd-tool-header-right">${parallelBadge}${durationHtml}<span class="gsd-tool-chevron">▸</span></span>
    </div>
    ${agentUsageHtml}
    ${outputHtml}
  </div>`;
}

function buildSystemHtml(entry: ChatEntry): string {
  const kind = entry.systemKind || "info";
  return `<div class="gsd-system-msg ${kind}">${escapeHtml(entry.systemText || "")}</div>`;
}
