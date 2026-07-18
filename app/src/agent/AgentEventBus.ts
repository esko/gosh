import type { AgentEvent, AgentEventType } from './types';

export type AgentEventListener = (event: AgentEvent) => void;

export type AgentSubscription = { dispose: () => void };

/** Monotonic event bus for control-plane lifecycle notifications. */
export class AgentEventBus {
  private seq = 0;
  private readonly listeners = new Set<AgentEventListener>();

  subscribe(listener: AgentEventListener): AgentSubscription {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  emit(
    type: AgentEventType,
    payload: {
      windowId: string;
      tabId?: string;
      paneId?: string;
      commandId?: string;
      exitCode?: number | null;
      url?: string;
    },
  ): AgentEvent {
    const event: AgentEvent = {
      seq: ++this.seq,
      type,
      at: Date.now(),
      windowId: payload.windowId,
      tabId: payload.tabId,
      paneId: payload.paneId,
      commandId: payload.commandId,
      exitCode: payload.exitCode,
      url: payload.url,
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* slow/broken subscribers must not break emitters */
      }
    }
    return event;
  }

  /** Test helper: last issued sequence number (0 if none). */
  get lastSeq(): number {
    return this.seq;
  }
}
