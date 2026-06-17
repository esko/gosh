import { parseTerminalConnectionCommand } from '../connections/sshCommandParser';
import type { Profile } from '../settings/types';
import { listProfiles, saveProfile } from '../storage/indexedDb';
import { escapeHTML, formatTime, requiredElement } from './dom';
import { readDiagnostics } from './diagnostics';
import { GhosttyTerminalAdapter, ensureGhosttyReady } from './ghosttyAdapter';
import { loadCustomFont, loadPwaSettings, savePwaSettings, applyPwaAppearance } from './settings';
import { loadRecentConnections, profileToSpec, recordConnection, specFromQuery, specTitle, specToQuery } from './profileModel';
import { shouldPassThroughSystemShortcut } from './shortcuts';
import { createTransport, type TerminalTransport } from './transport';
import type { TerminalTransportStatus } from './types';

let activeTransport: TerminalTransport | null = null;
let activeTerminal: GhosttyTerminalAdapter | null = null;

export async function renderApp(root: HTMLElement): Promise<void> {
  disposeTerminal();
  const path = window.location.pathname;
  if (path === '/terminal') {
    await renderTerminal(root);
  } else {
    await renderHome(root);
  }
}

async function renderHome(root: HTMLElement): Promise<void> {
  const [profiles, diagnostics] = await Promise.all([listProfiles(), readDiagnostics()]);
  const recents = loadRecentConnections();
  root.innerHTML = `
    <header class="topbar">
      <div class="brand">iwa-ssh</div>
      <a class="toolbar-button" href="/terminal" title="New terminal" aria-label="New terminal">+</a>
    </header>
    <main class="home-grid">
      <section class="panel launcher-panel">
        <div class="panel-heading">
          <h1>Profiles</h1>
          <button class="primary-button" id="newProfile" type="button">New profile</button>
        </div>
        <form id="quickConnect" class="quick-connect">
          <input id="quickCommand" name="command" type="text" autocomplete="off" spellcheck="false" placeholder="ssh user@host -p 22" />
          <button class="primary-button" type="submit">Connect</button>
        </form>
        <div class="profile-list">
          ${
            profiles.length
              ? profiles.map(profileCard).join('')
              : '<p class="muted">No profiles yet. Create one or use quick connect.</p>'
          }
        </div>
      </section>
      <section class="panel">
        <h2>Recent</h2>
        <div class="recent-list">
          ${
            recents.length
              ? recents
                  .map(
                    (recent) => `
                      <button class="recent-row" type="button" data-spec="${escapeHTML(specToQuery(recent))}">
                        <span>${escapeHTML(recent.title)}</span>
                        <small>${escapeHTML(formatTime(recent.connectedAt))}</small>
                      </button>
                    `,
                  )
                  .join('')
              : '<p class="muted">Recent connections appear here after launch.</p>'
          }
        </div>
      </section>
      <section class="panel settings-panel">
        ${settingsFormMarkup()}
      </section>
      <section class="panel diagnostics-panel">
        <h2>IWA readiness</h2>
        <dl class="diagnostic-list">
          ${diagnosticRow('Cross-origin isolated', diagnostics.crossOriginIsolated)}
          ${diagnosticRow('Direct Sockets', diagnostics.directSockets)}
          ${diagnosticRow('Private/UDP sockets', diagnostics.directSocketsPrivate)}
          ${diagnosticRow('nassh/wassh assets', diagnostics.upstreamAssets)}
          ${diagnosticRow('Launch queue', diagnostics.launchQueue)}
        </dl>
      </section>
    </main>
    <dialog id="profileDialog" class="profile-dialog">
      ${profileFormMarkup()}
    </dialog>
  `;

  requiredElement<HTMLFormElement>('#quickConnect', root).addEventListener('submit', (event) => {
    event.preventDefault();
    const input = requiredElement<HTMLInputElement>('#quickCommand', root).value;
    const spec = parseTerminalConnectionCommand(input);
    if (!spec) return;
    navigate(`/terminal?${specToQuery(spec)}`);
  });

  root.querySelectorAll<HTMLElement>('[data-profile-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const profile = profiles.find((item) => item.id === button.dataset.profileId);
      if (!profile) return;
      navigate(`/terminal?${specToQuery(profileToSpec(profile))}`);
    });
  });

  root.querySelectorAll<HTMLElement>('[data-spec]').forEach((button) => {
    button.addEventListener('click', () => navigate(`/terminal?${button.dataset.spec ?? ''}`));
  });

  wireSettingsForm(root);
  wireProfileDialog(root);
}

async function renderTerminal(root: HTMLElement): Promise<void> {
  const query = new URLSearchParams(window.location.search);
  let spec = specFromQuery(query);
  if (query.get('profile')) {
    const profile = (await listProfiles()).find((item) => item.id === query.get('profile'));
    if (profile) spec = profileToSpec(profile);
  }

  if (!spec) {
    renderTerminalConnect(root);
    return;
  }

  const settings = loadPwaSettings();
  applyPwaAppearance(settings);
  await loadCustomFont(settings);
  await ensureGhosttyReady();

  document.title = `${specTitle(spec)} - iwa-ssh`;
  root.innerHTML = `
    <header class="topbar terminal-topbar">
      <a class="brand" href="/">iwa-ssh</a>
      <div class="terminal-title">${escapeHTML(specTitle(spec))}</div>
      <div id="status" class="status" data-state="connecting">Connecting</div>
      <button id="reconnect" class="toolbar-button" type="button" title="Reconnect" aria-label="Reconnect">r</button>
    </header>
    <main id="terminal" class="terminal-root" aria-label="Terminal"></main>
  `;

  const terminalRoot = requiredElement<HTMLElement>('#terminal', root);
  const status = requiredElement<HTMLElement>('#status', root);
  const updateStatus = (state: TerminalTransportStatus, error?: string) => {
    status.dataset.state = state;
    status.textContent = error ? `${state}: ${error}` : state;
  };

  activeTerminal = new GhosttyTerminalAdapter(settings);
  activeTerminal.open(terminalRoot);
  activeTransport = createTransport(spec, updateStatus);
  installShortcutPassThrough();
  await recordConnection(spec);
  await activeTransport.connect(activeTerminal);

  requiredElement<HTMLButtonElement>('#reconnect', root).addEventListener('click', async () => {
    activeTerminal?.write('\x1b[2J\x1b[H');
    await activeTransport?.disconnect();
    await activeTransport?.connect(activeTerminal!);
  });
}

function renderTerminalConnect(root: HTMLElement): void {
  root.innerHTML = `
    <header class="topbar">
      <a class="brand" href="/">iwa-ssh</a>
      <div class="status" data-state="idle">No connection</div>
    </header>
    <main class="connect-page">
      <form id="terminalConnect" class="panel quick-connect terminal-connect">
        <h1>Connect</h1>
        <input id="terminalCommand" name="command" type="text" autocomplete="off" spellcheck="false" placeholder="ssh user@host -p 22" autofocus />
        <div class="button-row">
          <button class="primary-button" type="submit">Connect</button>
          <button class="secondary-button" type="button" id="echoSmoke">Echo smoke</button>
        </div>
      </form>
    </main>
  `;
  requiredElement<HTMLFormElement>('#terminalConnect', root).addEventListener('submit', (event) => {
    event.preventDefault();
    const input = requiredElement<HTMLInputElement>('#terminalCommand', root).value;
    const spec = parseTerminalConnectionCommand(input);
    if (!spec) return;
    navigate(`/terminal?${specToQuery(spec)}`);
  });
  requiredElement<HTMLButtonElement>('#echoSmoke', root).addEventListener('click', () => {
    navigate('/terminal?protocol=echo&host=local&username=smoke');
  });
}

function profileCard(profile: Profile): string {
  const spec = profileToSpec(profile);
  return `
    <button class="profile-card" type="button" data-profile-id="${escapeHTML(profile.id)}">
      <strong>${escapeHTML(profile.name)}</strong>
      <span>${escapeHTML(specTitle(spec))}</span>
      <small>${escapeHTML(formatTime(profile.lastConnectedAt))}</small>
    </button>
  `;
}

function profileFormMarkup(): string {
  return `
    <form id="profileForm" method="dialog">
      <h2>New profile</h2>
      <label>Name<input name="name" required /></label>
      <label>Protocol
        <select name="protocol">
          <option value="ssh">SSH</option>
          <option value="mosh">Mosh</option>
        </select>
      </label>
      <label>Host<input name="host" required /></label>
      <label>Port<input name="port" type="number" min="1" max="65535" value="22" /></label>
      <label>Username<input name="username" required /></label>
      <label>SSH arguments<input name="connectionArgs" placeholder="-o ServerAliveInterval=30" /></label>
      <label>Startup command<input name="startupCommand" /></label>
      <div class="dialog-actions">
        <button class="secondary-button" value="cancel">Cancel</button>
        <button class="primary-button" value="save">Save</button>
      </div>
    </form>
  `;
}

function settingsFormMarkup(): string {
  const settings = loadPwaSettings();
  return `
    <form id="settingsForm">
      <h2>Settings</h2>
      <label>Font family<input name="fontFamily" value="${escapeHTML(settings.fontFamily)}" /></label>
      <label>Font size<input name="fontSize" type="number" min="12" max="22" value="${settings.fontSize}" /></label>
      <label>Scrollback
        <select name="scrollback">
          ${[1000, 5000, 10000, 20000].map((value) => `<option value="${value}"${settings.scrollback === value ? ' selected' : ''}>${value}</option>`).join('')}
        </select>
      </label>
      <label>Theme
        <select name="theme">
          ${['dark', 'highContrast', 'soft', 'light', 'tokyoNight', 'dracula'].map((value) => `<option value="${value}"${settings.theme.preset === value ? ' selected' : ''}>${value}</option>`).join('')}
        </select>
      </label>
      <button class="secondary-button" type="submit">Save settings</button>
    </form>
  `;
}

function wireSettingsForm(root: HTMLElement): void {
  requiredElement<HTMLFormElement>('#settingsForm', root).addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const current = loadPwaSettings();
    savePwaSettings({
      ...current,
      fontFamily: String(data.get('fontFamily') ?? current.fontFamily),
      fontSize: Number(data.get('fontSize') ?? current.fontSize),
      scrollback: Number(data.get('scrollback') ?? current.scrollback),
      theme: { preset: String(data.get('theme') ?? current.theme.preset) },
    });
    void renderHome(root);
  });
}

function wireProfileDialog(root: HTMLElement): void {
  const dialog = requiredElement<HTMLDialogElement>('#profileDialog', root);
  requiredElement<HTMLButtonElement>('#newProfile', root).addEventListener('click', () => dialog.showModal());
  dialog.addEventListener('close', async () => {
    if (dialog.returnValue !== 'save') return;
    const data = new FormData(requiredElement<HTMLFormElement>('#profileForm', dialog));
    const profile: Profile = {
      id: crypto.randomUUID(),
      name: String(data.get('name') ?? '').trim(),
      protocol: String(data.get('protocol') ?? 'ssh') === 'mosh' ? 'mosh' : 'ssh',
      host: String(data.get('host') ?? '').trim(),
      port: Number(data.get('port') ?? 22),
      username: String(data.get('username') ?? '').trim(),
      connectionArgs: String(data.get('connectionArgs') ?? '').trim() || undefined,
      startupCommand: String(data.get('startupCommand') ?? '').trim() || undefined,
    };
    if (!profile.name || !profile.host || !profile.username) return;
    await saveProfile(profile);
    await renderHome(root);
  });
}

function diagnosticRow(label: string, ok: boolean): string {
  return `<div><dt>${escapeHTML(label)}</dt><dd data-ok="${ok}">${ok ? 'ready' : 'missing'}</dd></div>`;
}

function installShortcutPassThrough(): void {
  document.addEventListener(
    'keydown',
    (event) => {
      if (shouldPassThroughSystemShortcut(event)) {
        event.stopImmediatePropagation();
      }
    },
    { capture: true },
  );
}

function navigate(url: string): void {
  history.pushState(null, '', url);
  void renderApp(requiredElement<HTMLElement>('#app'));
}

function disposeTerminal(): void {
  void activeTransport?.disconnect().catch(() => undefined);
  activeTransport?.dispose();
  activeTerminal?.dispose();
  activeTransport = null;
  activeTerminal = null;
}
