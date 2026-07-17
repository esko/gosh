import { describe, expect, it, vi } from 'vitest';
import {
  dismissActiveAuthPrompts,
  registerAuthPromptDismiss,
  restoreFocusAfterAuthPrompt,
  setAuthPromptFocusRestore,
} from './authPromptLifecycle';

describe('authPromptLifecycle', () => {
  it('dismisses every registered prompt and ignores unregisterd ones', () => {
    const a = vi.fn();
    const b = vi.fn();
    const unregisterA = registerAuthPromptDismiss(a);
    registerAuthPromptDismiss(b);

    unregisterA();
    dismissActiveAuthPrompts();

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
  });

  it('is safe when a dismisser unregisters itself', () => {
    let unregister = (): void => undefined;
    const selfRemoving = vi.fn(() => unregister());
    unregister = registerAuthPromptDismiss(selfRemoving);
    dismissActiveAuthPrompts();
    expect(selfRemoving).toHaveBeenCalledOnce();
    dismissActiveAuthPrompts();
    expect(selfRemoving).toHaveBeenCalledOnce();
  });

  it('restores terminal focus after an auth prompt closes', async () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    const restore = vi.fn();
    setAuthPromptFocusRestore(restore);
    try {
      restoreFocusAfterAuthPrompt();
      expect(restore).toHaveBeenCalledOnce();
    } finally {
      setAuthPromptFocusRestore(null);
      vi.unstubAllGlobals();
    }
  });
});
