/** Reject agent terminal.send / terminal.run when human typed within this window. */
export const HUMAN_INPUT_GUARD_MS = 750;

/**
 * Tracks last local keyboard/paste time per opaque pane id.
 * Agent-originated sends do not update this map.
 */
export class HumanInputTracker {
  private readonly lastHumanInputAt = new Map<string, number>();

  noteHumanInput(paneId: string, at: number): void {
    this.lastHumanInputAt.set(paneId, at);
  }

  clearPane(paneId: string): void {
    this.lastHumanInputAt.delete(paneId);
  }

  isBlocked(paneId: string, now: number, windowMs = HUMAN_INPUT_GUARD_MS): boolean {
    const last = this.lastHumanInputAt.get(paneId);
    if (last === undefined) return false;
    return now - last < windowMs;
  }
}
