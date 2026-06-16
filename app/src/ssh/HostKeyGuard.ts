/**
 * Intercept OpenSSH host-key prompts in terminal output and drive KnownHostPrompt.
 */

import { log } from '../debug/logger';
import { ensureHostTrusted } from './KnownHostPrompt';
import { syncKnownHostsFromNassh } from './nasshKnownHosts';

const FINGERPRINT_RE =
  /(ED25519|RSA|ECDSA|EC|DSA|SK-ED25519|SK-ECDSA) key fingerprint is (SHA256:[A-Za-z0-9+/]+=*)/i;
const CONTINUE_PROMPT_RE = /continue connecting \(yes\/no(?:\/\[fingerprint\])?\)/i;
const PERMANENTLY_ADDED_RE = /Permanently added (.+?) to the list of known hosts/i;

export type HostKeyGuardOptions = {
  host: string;
  port: number;
  sendResponse: (data: string) => void;
  onDenied?: () => void;
};

export class HostKeyGuard {
  private buffer = '';
  private promptInFlight = false;
  private readonly maxBuffer = 8192;

  constructor(private readonly options: HostKeyGuardOptions) {}

  reset(): void {
    this.buffer = '';
    this.promptInFlight = false;
  }

  async handleOutput(data: string | Uint8Array): Promise<void> {
    const chunk = typeof data === 'string' ? data : new TextDecoder().decode(data);
    this.buffer = (this.buffer + chunk).slice(-this.maxBuffer);

    const added = PERMANENTLY_ADDED_RE.exec(this.buffer);
    if (added) {
      log.knownHosts.debug('ssh permanently added host key', { detail: added[1] });
      void syncKnownHostsFromNassh(this.options.host, this.options.port).catch((error) => {
        log.knownHosts.warn('failed to sync known_hosts', { error });
      });
    }

    if (this.promptInFlight) return;

    const fingerprintMatch = FINGERPRINT_RE.exec(this.buffer);
    if (!fingerprintMatch) return;
    if (!CONTINUE_PROMPT_RE.test(this.buffer)) return;

    const keyType = normalizeKeyType(fingerprintMatch[1]!);
    const fingerprint = fingerprintMatch[2]!;

    this.promptInFlight = true;
    log.knownHosts.info('host key prompt detected', {
      host: this.options.host,
      port: this.options.port,
      keyType,
      fingerprint,
    });

    try {
      const trusted = await ensureHostTrusted(
        this.options.host,
        this.options.port,
        fingerprint,
        keyType,
        { useLiveVerification: true },
      );

      if (trusted) {
        this.options.sendResponse('yes\n');
      } else {
        this.options.sendResponse('no\n');
        this.options.onDenied?.();
      }
    } catch (error) {
      log.knownHosts.error('host key prompt failed', { error });
      this.options.sendResponse('no\n');
      this.options.onDenied?.();
    } finally {
      this.promptInFlight = false;
    }
  }
}

function normalizeKeyType(raw: string): string {
  const upper = raw.toUpperCase();
  if (upper === 'EC') return 'ecdsa-sha2-nistp256';
  if (upper.startsWith('SK-')) return `ssh-${raw.toLowerCase()}@openssh.com`;
  if (upper === 'RSA') return 'ssh-rsa';
  if (upper === 'ED25519') return 'ssh-ed25519';
  if (upper === 'DSA') return 'ssh-dss';
  return `ssh-${raw.toLowerCase()}`;
}
