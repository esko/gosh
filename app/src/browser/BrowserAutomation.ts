import type { ControlledFrameElementLike } from './controlledFrameTypes';
import type {
  BrowserQueryMatch,
  BrowserQueryResult,
  BrowserSnapshotResult,
  BrowserWaitForResult,
  BrowserWaitForState,
} from './browserAutomationTypes';
import {
  buildInteractionScript,
  buildQueryScript,
  buildSnapshotScript,
  buildWaitScript,
  parseInteractionResult,
  parseQueryPayload,
  parseSnapshotPayload,
  parseWaitPayload,
} from './browserSnapshotScript';

export type BrowserAutomationOptions = {
  tabId: string;
  sleep?: (ms: number) => Promise<void>;
  isLoading?: () => boolean;
};

/**
 * Controlled Frame browser automation (snapshot, query, click/type/press).
 * Uses executeScript with fixed helpers only — not exposed as agent evaluate.
 */
export class BrowserAutomation {
  private generation = 0;
  private readonly tabId: string;
  private readonly element: ControlledFrameElementLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly isLoadingFn?: () => boolean;

  constructor(element: ControlledFrameElementLike, options: BrowserAutomationOptions) {
    this.element = element;
    this.tabId = options.tabId;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.isLoadingFn = options.isLoading;
  }

  getRefGeneration(): number {
    return this.generation;
  }

  /** Invalidate temporary element refs after navigation or DOM replacement. */
  invalidateRefs(): void {
    this.generation += 1;
  }

  async snapshot(opts?: { maxNodes?: number; maxBytes?: number }): Promise<BrowserSnapshotResult> {
    const raw = await this.runScript(buildSnapshotScript({ generation: this.generation, ...opts }));
    const payload = parseSnapshotPayload(raw);
    if (payload.generation !== this.generation) {
      this.generation = payload.generation;
    }
    return {
      tabId: this.tabId,
      url: payload.url,
      title: payload.title,
      generation: payload.generation,
      nodes: payload.nodes,
      truncated: payload.truncated,
      byteLength: payload.byteLength,
    };
  }

  async query(input: {
    role?: string;
    name?: string;
    text?: string;
    selector?: string;
  }): Promise<BrowserQueryResult> {
    const raw = await this.runScript(
      buildQueryScript({
        generation: this.generation,
        role: input.role,
        name: input.name,
        text: input.text,
        selector: input.selector,
      }),
    );
    const payload = parseQueryPayload(raw);
    return {
      tabId: this.tabId,
      matches: payload.matches as BrowserQueryMatch[],
    };
  }

  async click(ref: string): Promise<void> {
    await this.interact({ ref, action: 'click' });
  }

  async type(ref: string, text: string, opts?: { clear?: boolean }): Promise<void> {
    await this.interact({ ref, action: 'type', text, clear: opts?.clear ?? true });
  }

  async press(ref: string, key: string): Promise<void> {
    await this.interact({ ref, action: 'press', key });
  }

  async waitFor(input: {
    selector?: string;
    text?: string;
    loadState?: BrowserWaitForState;
    timeoutMs?: number;
    pollIntervalMs?: number;
  }): Promise<BrowserWaitForResult> {
    const timeoutMs = input.timeoutMs ?? 10_000;
    const pollIntervalMs = input.pollIntervalMs ?? 100;
    const deadline = Date.now() + timeoutMs;

    if (input.loadState === 'load') {
      while (Date.now() < deadline) {
        if (!this.isLoading()) {
          return { tabId: this.tabId, satisfied: true, reason: 'load' };
        }
        await this.sleep(pollIntervalMs);
      }
      return { tabId: this.tabId, satisfied: false, reason: 'timeout' };
    }

    if (input.loadState === 'idle') {
      while (Date.now() < deadline) {
        if (!this.isLoading()) {
          await this.sleep(50);
          if (!this.isLoading()) {
            return { tabId: this.tabId, satisfied: true, reason: 'idle' };
          }
        }
        await this.sleep(pollIntervalMs);
      }
      return { tabId: this.tabId, satisfied: false, reason: 'timeout' };
    }

    const reason = input.selector ? 'selector' : 'text';
    while (Date.now() < deadline) {
      const raw = await this.runScript(
        buildWaitScript({
          generation: this.generation,
          selector: input.selector,
          text: input.text,
        }),
      );
      if (parseWaitPayload(raw).found) {
        return { tabId: this.tabId, satisfied: true, reason };
      }
      await this.sleep(pollIntervalMs);
    }
    return { tabId: this.tabId, satisfied: false, reason: 'timeout' };
  }

  private async interact(payload: {
    ref: string;
    action: 'click' | 'type' | 'press';
    text?: string;
    key?: string;
    clear?: boolean;
  }): Promise<void> {
    const raw = await this.runScript(
      buildInteractionScript({
        generation: this.generation,
        ref: payload.ref,
        action: payload.action,
        text: payload.text,
        key: payload.key,
        clear: payload.clear,
      }),
    );
    const result = parseInteractionResult(raw);
    if (!result.ok) {
      const message = result.message || result.error;
      if (result.error === 'stale-ref') {
        throw new Error(`Stale element ref: ${payload.ref} (${message})`);
      }
      throw new Error(message);
    }
  }

  private isLoading(): boolean {
    if (this.isLoadingFn) return this.isLoadingFn();
    return Boolean(this.element.isLoading?.());
  }

  private async runScript(code: string): Promise<unknown> {
    if (!this.element.executeScript) {
      throw new Error('Controlled Frame executeScript is not available');
    }
    return this.element.executeScript({ code });
  }
}
