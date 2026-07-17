/**
 * Session-bound auth UI (password / host-key modals). Switching tabs must
 * dismiss these so a prompt for tab A cannot sit over tab B.
 */

const dismissers = new Set<() => void>();
let focusRestore: (() => void) | null = null;

/** Register a dismiss callback; returns an unregister function. */
export function registerAuthPromptDismiss(dismiss: () => void): () => void {
  dismissers.add(dismiss);
  return () => {
    dismissers.delete(dismiss);
  };
}

/** Cancel every open secure-input / host-key prompt. */
export function dismissActiveAuthPrompts(): void {
  for (const dismiss of [...dismissers]) dismiss();
}

/**
 * Wired by the terminal view so password / host-key modals can return keyboard
 * focus to the active Restty surface after they close (otherwise the document
 * keeps body focus and the session needs a click before it accepts typing).
 */
export function setAuthPromptFocusRestore(handler: (() => void) | null): void {
  focusRestore = handler;
}

/** Schedule focus restore after the modal DOM has been removed. */
export function restoreFocusAfterAuthPrompt(): void {
  const restore = focusRestore;
  if (!restore) return;
  const schedule = globalThis.requestAnimationFrame?.bind(globalThis) ?? ((cb: FrameRequestCallback) => globalThis.setTimeout(cb, 0));
  schedule(() => restore());
}
