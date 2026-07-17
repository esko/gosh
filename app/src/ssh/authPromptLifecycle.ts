/**
 * Session-bound auth UI (password / host-key modals). Switching tabs must
 * dismiss these so a prompt for tab A cannot sit over tab B.
 */

const dismissers = new Set<() => void>();

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
