import { loadSettings } from '../storage/indexedDb';
import { confirmCloseSessionTab } from './sessionCloseGuard';
import { usesSimulatedTabs } from './tabMode';

export type SimTab = {
  id: string;
  path: string;
  title: string;
  pinned: boolean;
};

const STORAGE_KEY = 'iwa-ssh:sim-tabs';

function defaultTabs(): SimTab[] {
  return [{ id: 'home', path: '/', title: 'Home', pinned: true }];
}

function loadTabs(): { tabs: SimTab[]; activeId: string } {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const tabs = defaultTabs();
      return { tabs, activeId: tabs[0].id };
    }
    const parsed = JSON.parse(raw) as { tabs: SimTab[]; activeId: string };
    if (!parsed.tabs?.length) {
      const tabs = defaultTabs();
      return { tabs, activeId: tabs[0].id };
    }
    return parsed;
  } catch {
    const tabs = defaultTabs();
    return { tabs, activeId: tabs[0].id };
  }
}

function saveTabs(tabs: SimTab[], activeId: string): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs, activeId }));
}

function titleForPath(path: string): string {
  if (path === '/') return 'Home';
  if (path === '/connect' || path.startsWith('/connect?')) return 'Connect';
  if (path === '/profiles') return 'Profiles';
  if (path === '/settings' || path.startsWith('/settings?')) return 'Settings';
  if (path === '/dev' || path === '/debug') return 'Debug';
  const session = path.match(/^\/session\/([^/]+)/);
  if (session) return `Session ${session[1].slice(0, 8)}…`;
  return 'Tab';
}

export type TabNavigateFn = (path: string) => void;

export class TabManager {
  private tabs: SimTab[];
  private activeId: string;
  private stripEl: HTMLElement | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(private readonly navigate: TabNavigateFn) {
    const stored = loadTabs();
    this.tabs = stored.tabs;
    this.activeId = stored.activeId;
    if (!this.tabs.some((t) => t.id === this.activeId)) {
      this.activeId = this.tabs[0].id;
    }
  }

  mount(container: HTMLElement): void {
    if (!usesSimulatedTabs()) return;

    this.stripEl = document.createElement('div');
    this.stripEl.className = 'sim-tab-strip';
    this.stripEl.setAttribute('role', 'tablist');
    this.stripEl.innerHTML = `
      <div class="sim-tab-strip__tabs" id="sim-tab-list"></div>
      <button type="button" class="sim-tab-strip__new" id="sim-tab-new" title="New tab (Ctrl+T)" aria-label="New tab">+</button>
      <span class="sim-tab-strip__badge" title="Native app tabs require tabbed IWA install">simulated tabs</span>
    `;
    container.prepend(this.stripEl);
    document.body.classList.add('has-sim-tabs');

    this.stripEl.querySelector('#sim-tab-new')?.addEventListener('click', () => {
      this.openTab('/connect', 'Connect');
    });

    this.keyHandler = (e) => void this.handleKeydown(e);
    window.addEventListener('keydown', this.keyHandler);
    this.render();
  }

  dispose(): void {
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    this.stripEl?.remove();
    this.stripEl = null;
    document.body.classList.remove('has-sim-tabs');
  }

  syncFromPath(path: string, title?: string): void {
    if (!usesSimulatedTabs()) return;
    const tab = this.tabs.find((t) => t.id === this.activeId);
    if (!tab) return;
    tab.path = path;
    if (title) tab.title = title;
    else if (tab.title === 'Home' && path !== '/') tab.title = titleForPath(path);
    else if (!title && path !== tab.path) tab.title = titleForPath(path);
    saveTabs(this.tabs, this.activeId);
    this.render();
  }

  go(path: string, title?: string): void {
    if (!usesSimulatedTabs()) {
      this.navigate(path);
      return;
    }
    this.syncActive(path, title);
    this.navigate(path);
  }

  openTab(path: string, title?: string): void {
    if (!usesSimulatedTabs()) {
      window.open(path, '_blank');
      return;
    }
    const tab: SimTab = {
      id: crypto.randomUUID(),
      path,
      title: title ?? titleForPath(path),
      pinned: false,
    };
    this.tabs.push(tab);
    this.activeId = tab.id;
    saveTabs(this.tabs, this.activeId);
    this.render();
    this.navigate(path);
  }

  setActiveTitle(title: string): void {
    if (!usesSimulatedTabs()) return;
    const tab = this.tabs.find((t) => t.id === this.activeId);
    if (!tab) return;
    tab.title = title;
    saveTabs(this.tabs, this.activeId);
    this.render();
  }

  closeActiveTab(): boolean {
    if (!usesSimulatedTabs()) return false;
    const tab = this.tabs.find((t) => t.id === this.activeId);
    if (!tab || tab.pinned) return false;
    void this.closeTab(tab.id);
    return true;
  }

  private syncActive(path: string, title?: string): void {
    const tab = this.tabs.find((t) => t.id === this.activeId);
    if (!tab) return;
    tab.path = path;
    if (title) tab.title = title;
    else tab.title = titleForPath(path);
    saveTabs(this.tabs, this.activeId);
    this.render();
  }

  private activate(tabId: string): void {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab || tab.id === this.activeId) return;
    this.activeId = tab.id;
    saveTabs(this.tabs, this.activeId);
    this.render();
    this.navigate(tab.path);
  }

  private async closeTab(tabId: string): Promise<void> {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab || tab.pinned) return;

    const ok = await confirmCloseSessionTab(tab.path);
    if (!ok) return;

    const idx = this.tabs.findIndex((t) => t.id === tabId);
    this.tabs.splice(idx, 1);
    if (this.activeId === tabId) {
      const next = this.tabs[Math.max(0, idx - 1)] ?? this.tabs[0];
      this.activeId = next.id;
      saveTabs(this.tabs, this.activeId);
      this.render();
      this.navigate(next.path);
    } else {
      saveTabs(this.tabs, this.activeId);
      this.render();
    }
  }

  private switchRelative(delta: number): void {
    const idx = this.tabs.findIndex((t) => t.id === this.activeId);
    if (idx < 0) return;
    const next = (idx + delta + this.tabs.length) % this.tabs.length;
    this.activate(this.tabs[next].id);
  }

  private activateByIndex(index: number): void {
    if (index < 1 || index > 9) return;
    const tab = this.tabs[index - 1];
    if (tab) this.activate(tab.id);
  }

  private async handleKeydown(e: KeyboardEvent): Promise<void> {
    const settings = await loadSettings();
    const kb = settings.keyboard;

    if (kb.ctrlTNewTab && e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 't') {
      e.preventDefault();
      this.openTab('/connect', 'Connect');
      return;
    }

    if (kb.ctrlWCloseTab && e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'w') {
      e.preventDefault();
      this.closeActiveTab();
      return;
    }

    if (kb.ctrlTabSwitch && e.ctrlKey && e.key === 'Tab') {
      e.preventDefault();
      this.switchRelative(e.shiftKey ? -1 : 1);
      return;
    }

    if (kb.altNumberSwitchTab && e.altKey && /^[1-9]$/.test(e.key)) {
      e.preventDefault();
      this.activateByIndex(Number(e.key));
    }
  }

  private render(): void {
    const list = this.stripEl?.querySelector('#sim-tab-list');
    if (!list) return;

    list.innerHTML = this.tabs
      .map(
        (tab) => `
      <div
        class="sim-tab${tab.id === this.activeId ? ' sim-tab--active' : ''}${tab.pinned ? ' sim-tab--pinned' : ''}"
        role="tab"
        aria-selected="${tab.id === this.activeId}"
        data-tab-id="${tab.id}"
      >
        <button type="button" class="sim-tab__label" data-tab-id="${tab.id}">${escapeHtml(tab.title)}</button>
        ${
          tab.pinned
            ? ''
            : `<button type="button" class="sim-tab__close" data-close-tab="${tab.id}" aria-label="Close tab">×</button>`
        }
      </div>`,
      )
      .join('');

    list.querySelectorAll('.sim-tab__label').forEach((el) => {
      el.addEventListener('click', () => {
        const id = (el as HTMLElement).dataset.tabId;
        if (id) this.activate(id);
      });
    });

    list.querySelectorAll('[data-close-tab]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (el as HTMLElement).dataset.closeTab;
        if (id) this.closeTab(id);
      });
    });
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

let manager: TabManager | null = null;

export function initTabManager(navigate: TabNavigateFn, shell: HTMLElement): TabManager | null {
  if (!usesSimulatedTabs()) return null;
  manager = new TabManager(navigate);
  manager.mount(shell);
  return manager;
}

export function getTabManager(): TabManager | null {
  return manager;
}
