export { createEntryElement, buildTimestampHtml, buildStaleEchoHtml, patchToolBlockElement, patchToolBlock, buildToolCallHtml } from "./render/html-builders";
export { stopElapsedTimer, clearMessages, renderNewEntry, getCurrentTurnElement, showPendingDots, ensureCurrentTurnElement, reattachTurnElement, appendToTextSegment, appendToolSegmentElement, appendServerToolSegment, completeServerToolSegment, updateToolSegmentElement, detectStaleEcho, initStreaming, registerElapsedTick, getMessagesContainer, getSegmentElements, setCurrentTurnElement, getPriorTurnElements, setPriorTurnElements, cancelPendingRender, resetStreamingInternals } from "./render/streaming";
export { finalizeCurrentTurn, resetStreamingState, createParallelBatch, expandParallelBatch, reopenParallelBatch, updateParallelBatchStatus, finalizeParallelBatch, updateBatchElapsed, getActiveBatchElement, getFinalizedBatchElement, clearActiveBatch, syncBatchState } from "./render/batches";

import { initStreaming, registerElapsedTick } from "./render/streaming";
import { getActiveBatchElement, updateBatchElapsed } from "./render/batches";

export interface RendererDeps {
  messagesContainer: HTMLElement;
  welcomeScreen: HTMLElement;
}

export function init(deps: RendererDeps): void {
  initStreaming(deps);
  registerElapsedTick(() => {
    if (getActiveBatchElement()) updateBatchElapsed();
  });
}
