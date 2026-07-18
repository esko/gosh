// @ts-expect-error jsdom ships without bundled types in this repo.
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { BrowserAutomation } from './BrowserAutomation';
import type { ControlledFrameElementLike } from './controlledFrameTypes';

class MockControlledFrameWithDom implements ControlledFrameElementLike {
  src = 'https://example.test/form';
  private readonly dom: JSDOM;
  private loading = false;
  submitted = false;

  constructor(html: string) {
    this.dom = new JSDOM(html, {
      url: 'https://example.test/form',
      runScripts: 'outside-only',
    });
    const form = this.dom.window.document.querySelector('form');
    form?.addEventListener('submit', (event: Event) => {
      event.preventDefault();
      this.submitted = true;
    });
  }

  async back(): Promise<boolean> {
    return false;
  }

  async forward(): Promise<boolean> {
    return false;
  }

  reload(): void {
    this.loading = true;
    this.loading = false;
  }

  isLoading(): boolean {
    return this.loading;
  }

  async executeScript(details: { code?: string }): Promise<unknown> {
    if (!details.code) throw new Error('code is required');
    return this.dom.window.eval(details.code);
  }

  addEventListener(): void {}
  removeEventListener(): void {}
}

const FORM_HTML = `
<!doctype html>
<html>
  <body>
    <h1>Sign in</h1>
    <form id="login">
      <label for="username">Username</label>
      <input id="username" name="username" type="text" autocomplete="username" />
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" />
      <button type="submit">Log in</button>
    </form>
  </body>
</html>
`;

describe('BrowserAutomation', () => {
  it('snapshots interactive nodes with redacted secret values', async () => {
    const frame = new MockControlledFrameWithDom(FORM_HTML);
    const automation = new BrowserAutomation(frame, { tabId: 'tab_browser' });

    const snapshot = await automation.snapshot();
    expect(snapshot.nodes.some((node) => node.ref === 'e1' && node.role === 'heading')).toBe(true);
    const password = snapshot.nodes.find((node) => node.role === 'textbox' && node.name === 'Password');
    expect(password?.value).toBe('[redacted]');
    const username = snapshot.nodes.find((node) => node.role === 'textbox' && node.name === 'Username');
    expect(username?.ref).toBeTruthy();
  });

  it('fills a form and submits via refs (e2e-style)', async () => {
    const frame = new MockControlledFrameWithDom(FORM_HTML);
    const automation = new BrowserAutomation(frame, { tabId: 'tab_browser' });

    const snapshot = await automation.snapshot();
    const usernameRef = snapshot.nodes.find((node) => node.name === 'Username')?.ref;
    const passwordRef = snapshot.nodes.find((node) => node.name === 'Password')?.ref;
    const submitRef = snapshot.nodes.find((node) => node.role === 'button' && node.name === 'Log in')?.ref;
    expect(usernameRef).toBeTruthy();
    expect(passwordRef).toBeTruthy();
    expect(submitRef).toBeTruthy();

    await automation.type(usernameRef!, 'agent-user');
    await automation.type(passwordRef!, 'hunter2');
    await automation.click(submitRef!);

    expect(frame.submitted).toBe(true);
    const refreshed = await automation.snapshot();
    const usernameValue = refreshed.nodes.find((node) => node.ref === usernameRef)?.value;
    const passwordValue = refreshed.nodes.find((node) => node.ref === passwordRef)?.value;
    expect(usernameValue).toBe('agent-user');
    expect(passwordValue).toBe('[redacted]');
  });

  it('invalidates refs after navigation', async () => {
    const frame = new MockControlledFrameWithDom(FORM_HTML);
    const automation = new BrowserAutomation(frame, { tabId: 'tab_browser' });
    const snapshot = await automation.snapshot();
    const usernameRef = snapshot.nodes.find((node) => node.name === 'Username')?.ref;
    expect(usernameRef).toBeTruthy();

    automation.invalidateRefs();
    await expect(automation.click(usernameRef!)).rejects.toThrow(/Stale element ref/);
  });

  it('queries nodes by role and name', async () => {
    const frame = new MockControlledFrameWithDom(FORM_HTML);
    const automation = new BrowserAutomation(frame, { tabId: 'tab_browser' });
    await automation.snapshot();
    const matches = await automation.query({ role: 'button', name: 'log' });
    expect(matches.matches).toHaveLength(1);
    expect(matches.matches[0]?.ref).toBeTruthy();
  });
});
