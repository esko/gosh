export type AuditEntry = {
  at: number;
  method: string;
  clientId: string;
  ok: boolean;
  errorCode?: string;
};

const DEFAULT_RING_SIZE = 100;

/** Recent control-plane actions without secrets or terminal payload. */
export class AuditRing {
  private readonly maxEntries: number;
  private readonly now: () => number;
  private entries: AuditEntry[] = [];
  private nextIndex = 0;

  constructor(options?: { maxEntries?: number; now?: () => number }) {
    this.maxEntries = options?.maxEntries ?? DEFAULT_RING_SIZE;
    this.now = options?.now ?? (() => Date.now());
  }

  append(entry: Omit<AuditEntry, 'at'> & { at?: number }): void {
    const record: AuditEntry = {
      at: entry.at ?? this.now(),
      method: entry.method,
      clientId: entry.clientId,
      ok: entry.ok,
      ...(entry.errorCode ? { errorCode: entry.errorCode } : {}),
    };
    if (this.entries.length < this.maxEntries) {
      this.entries.push(record);
      return;
    }
    this.entries[this.nextIndex] = record;
    this.nextIndex = (this.nextIndex + 1) % this.maxEntries;
  }

  list(): readonly AuditEntry[] {
    if (this.entries.length < this.maxEntries) return [...this.entries];
    return [...this.entries.slice(this.nextIndex), ...this.entries.slice(0, this.nextIndex)];
  }

  clear(): void {
    this.entries = [];
    this.nextIndex = 0;
  }
}
