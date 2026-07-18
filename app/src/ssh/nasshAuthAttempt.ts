import type { CredentialTarget } from '../security/savedPasswords';
import type { HostKeyGuard } from './HostKeyGuard';
import {
  resolveSecureInputWithSavedPassword,
  type SecureInputCredentialState,
} from './secureInputCredentials';

export type AuthPromptPolicy = 'interactive' | 'silent';

export type NasshAuthAttemptOptions = {
  policy: AuthPromptPolicy;
  target: CredentialTarget;
  hostKeyGuard: HostKeyGuard | null;
  isInactive: () => boolean;
  onCancel: (reason: 'user' | 'unavailable') => void;
};

export type NasshAuthAttempt = {
  credentialState: SecureInputCredentialState;
  wasCancelled: () => boolean;
  wasUnavailable: () => boolean;
  secureInput: (message: string, bufLen: number, echo: boolean) => Promise<string>;
};

/**
 * Single secureInput/auth-cancel seam for nassh CommandInstance connections.
 * Host-key prompts are consumed before password handling.
 */
export function createNasshAuthAttempt(options: NasshAuthAttemptOptions): NasshAuthAttempt {
  const credentialState: SecureInputCredentialState = { loginPasswordProvided: false };
  let cancelled = false;
  let unavailable = false;

  const secureInput = async (message: string, bufLen: number, echo: boolean): Promise<string> => {
    if (options.isInactive() || cancelled) return '';

    const hostKeyResponse = await options.hostKeyGuard?.consumePendingHostKeyResponse(message);
    if (hostKeyResponse) return hostKeyResponse.slice(0, bufLen);
    if (options.isInactive() || cancelled) return '';

    const result = await resolveSecureInputWithSavedPassword(
      message,
      bufLen,
      echo,
      options.target,
      credentialState,
      { mode: options.policy },
    );
    if (options.isInactive() || cancelled) return '';

    if (result.status === 'cancelled') {
      cancelled = true;
      unavailable = result.reason === 'unavailable';
      options.onCancel(result.reason ?? 'user');
      return '';
    }
    return result.value;
  };

  return {
    credentialState,
    wasCancelled: () => cancelled,
    wasUnavailable: () => unavailable,
    secureInput,
  };
}
