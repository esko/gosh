import { describe, expect, it } from 'vitest';
import { shouldPassThroughSystemShortcut } from './shortcuts';

function keyEvent(init: Partial<KeyboardEvent>): KeyboardEvent {
  return init as KeyboardEvent;
}

describe('ChromeOS shortcut pass-through', () => {
  it('lets native tab and browser shortcuts pass through', () => {
    expect(shouldPassThroughSystemShortcut(keyEvent({ code: 'KeyT', ctrlKey: true }))).toBe(true);
    expect(shouldPassThroughSystemShortcut(keyEvent({ code: 'KeyW', ctrlKey: true }))).toBe(true);
    expect(shouldPassThroughSystemShortcut(keyEvent({ code: 'Tab', ctrlKey: true }))).toBe(true);
    expect(shouldPassThroughSystemShortcut(keyEvent({ code: 'KeyR', ctrlKey: true }))).toBe(true);
  });

  it('keeps common terminal control keys available to the terminal', () => {
    expect(shouldPassThroughSystemShortcut(keyEvent({ code: 'KeyC', ctrlKey: true }))).toBe(false);
    expect(shouldPassThroughSystemShortcut(keyEvent({ code: 'KeyD', ctrlKey: true }))).toBe(false);
    expect(shouldPassThroughSystemShortcut(keyEvent({ code: 'KeyL', ctrlKey: true }))).toBe(false);
  });
});
