import { Router } from '../app-shell/router';
import { ensureHostTrusted, stubHostFingerprint } from '../ssh/KnownHostPrompt';
import { identitySelectMarkup, wireIdentityImportButton } from '../ssh/KeyImport';
import { areUpstreamAssetsReady } from '../ssh/upstreamAssets';
import { getProfile, listIdentities, saveProfile } from '../storage/indexedDb';
import type { Profile } from '../settings/types';
import { createSshMoshDialogModel } from '../terminal-shell';
import { parseTerminalConnectionCommand } from '../connections/sshCommandParser';
import { escapeHtml, shell } from './shared';

export type StoredSessionParams = {
  profileId?: string;
  protocol?: 'ssh' | 'mosh';
  host: string;
  port: number;
  username: string;
  identityId?: string;
  connectionArgs?: string;
  startupCommand?: string;
};

/**
 * Encode the connection into the session URL, mirroring upstream nassh/Terminal
 * which carry the connection (profile-id or ssh:// string) in the URL rather
 * than in storage. A new tab/window reconstructs the session from its own URL,
 * so it works across browsing contexts. Only non-secret params live here; key
 * material and passphrases never do.
 */
export function buildSessionPath(id: string, params: StoredSessionParams): string {
  const q = new URLSearchParams();
  q.set('host', params.host);
  q.set('port', String(params.port));
  q.set('user', params.username);
  if (params.protocol) q.set('protocol', params.protocol);
  if (params.profileId) q.set('profile', params.profileId);
  if (params.identityId) q.set('identity', params.identityId);
  if (params.connectionArgs) q.set('args', params.connectionArgs);
  if (params.startupCommand) q.set('startup', params.startupCommand);
  return `/session/${encodeURIComponent(id)}?${q.toString()}`;
}

/** Reconstruct connection params from a session URL query (see buildSessionPath). */
export function sessionParamsFromQuery(query: URLSearchParams): StoredSessionParams | null {
  const host = query.get('host')?.trim();
  const username = query.get('user')?.trim();
  if (!host || !username) return null;
  const port = Number(query.get('port'));
  return {
    host,
    username,
    port: Number.isFinite(port) && port > 0 ? port : 22,
    protocol: query.get('protocol') === 'mosh' ? 'mosh' : 'ssh',
    profileId: query.get('profile') || undefined,
    identityId: query.get('identity') || undefined,
    connectionArgs: query.get('args') || undefined,
    startupCommand: query.get('startup') || undefined,
  };
}

export async function renderConnect(root: HTMLElement, query: URLSearchParams): Promise<void> {
  const profileId = query.get('profile') ?? undefined;
  const profile = profileId ? await getProfile(profileId) : undefined;
  const identities = await listIdentities();
  const model = createSshMoshDialogModel(profile, identities);

  const identityOptions = identitySelectMarkup(model.identities, model.identityId);

  root.innerHTML = shell(
    'Connect',
    `
      <form id="connect-form" class="form panel" novalidate>
        <div class="form-row">
          <label for="connection-command">SSH command</label>
          <input id="connection-command" name="connectionCommand" type="text" autocomplete="off" spellcheck="false"
            placeholder='ssh -p 2222 "user@host"' />
        </div>
        <div class="form-row">
          <label for="protocol">Protocol</label>
          <select id="protocol" name="protocol">
            <option value="ssh"${model.protocol === 'ssh' ? ' selected' : ''}>SSH</option>
            <option value="mosh"${model.protocol === 'mosh' ? ' selected' : ''}>Mosh</option>
          </select>
        </div>
        <div class="form-row">
          <label for="host">Host</label>
          <input id="host" name="host" type="text" autocomplete="off" spellcheck="false"
            value="${escapeHtml(model.host)}" placeholder="example.com" />
        </div>
        <div class="form-row">
          <label for="port">Port</label>
          <input id="port" name="port" type="number" min="1" max="65535"
            value="${model.port}" />
        </div>
        <div class="form-row">
          <label for="username">Username</label>
          <input id="username" name="username" type="text" autocomplete="username" spellcheck="false"
            value="${escapeHtml(model.username)}" placeholder="user" />
        </div>
        <div class="form-row">
          <label for="identity">Identity</label>
          <div class="identity-row">
            <select id="identity" name="identity">${identityOptions}</select>
            <button type="button" id="import-identity" class="btn">Import key</button>
          </div>
        </div>
        <div class="form-row">
          <label for="startup-command">Startup command</label>
          <input id="startup-command" name="startupCommand" type="text" autocomplete="off" spellcheck="false"
            value="${escapeHtml(model.startupCommand)}" placeholder="Optional command to run after login" />
        </div>
        <fieldset class="form-fieldset">
          <legend>Save profile</legend>
          <label class="checkbox-row">
            <input id="save-profile" name="saveProfile" type="checkbox" ${model.saveProfile ? 'checked' : ''} />
            <span>Save connection as profile</span>
          </label>
          <div class="form-row" id="profile-name-row">
            <label for="profile-name">Profile name</label>
            <input id="profile-name" name="profileName" type="text" spellcheck="false"
              value="${escapeHtml(model.profileName)}" placeholder="My server" />
          </div>
        </fieldset>
        <div class="button-row">
          <button type="submit" class="btn primary">Connect</button>
          <button type="button" id="cancel-connect" class="btn">Cancel</button>
        </div>
      </form>
    `,
    `<button type="button" id="header-profiles" class="btn">Profiles</button>`,
  );

  const saveProfileCheckbox = root.querySelector<HTMLInputElement>('#save-profile');
  const profileNameRow = root.querySelector<HTMLElement>('#profile-name-row');

  const syncProfileNameVisibility = () => {
    if (!profileNameRow || !saveProfileCheckbox) return;
    profileNameRow.hidden = !saveProfileCheckbox.checked;
  };
  saveProfileCheckbox?.addEventListener('change', syncProfileNameVisibility);
  syncProfileNameVisibility();

  root.querySelector('#cancel-connect')?.addEventListener('click', () => Router.go('/'));
  root.querySelector('#header-profiles')?.addEventListener('click', () => Router.go('/profiles'));
  await wireIdentityImportButton(root, '#identity', 'import-identity');

  root.querySelector('#connect-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const data = new FormData(form);

    const command = String(data.get('connectionCommand') ?? '').trim();
    const parsedCommand = command ? parseTerminalConnectionCommand(command) : null;
    const protocol = parsedCommand?.protocol ?? (String(data.get('protocol') ?? 'ssh') === 'mosh' ? 'mosh' : 'ssh');
    const host = parsedCommand?.hostname ?? String(data.get('host') ?? '').trim();
    const port = parsedCommand?.port ?? Number(data.get('port') ?? 22);
    const username = parsedCommand?.username ?? String(data.get('username') ?? '').trim();
    const identityId = String(data.get('identity') ?? '') || undefined;
    const connectionArgs = parsedCommand?.argstr;
    const startupCommand = String(data.get('startupCommand') ?? '').trim() || undefined;
    const shouldSave = data.get('saveProfile') === 'on';
    const profileName = String(data.get('profileName') ?? '').trim();

    if (!host || !username || !Number.isFinite(port)) return;

    const upstreamReady = await areUpstreamAssetsReady();
    if (!upstreamReady) {
      const trusted = await ensureHostTrusted(host, port, stubHostFingerprint(host, port), 'ssh-ed25519', {
      useLiveVerification: false,
    });
      if (!trusted) return;
    }

    let savedProfileId = profile?.id;

    if (shouldSave) {
      const name = profileName || `${username}@${host}`;
      const nextProfile: Profile = {
        id: profile?.id ?? crypto.randomUUID(),
        name,
        protocol,
        host,
        port,
        username,
        identityId,
        connectionArgs,
        startupCommand,
        lastConnectedAt: Date.now(),
      };
      await saveProfile(nextProfile);
      savedProfileId = nextProfile.id;
    } else if (profile) {
      await saveProfile({ ...profile, lastConnectedAt: Date.now() });
    }

    const sessionId = crypto.randomUUID();
    Router.openTab(
      buildSessionPath(sessionId, {
        profileId: savedProfileId,
        protocol,
        host,
        port,
        username,
        identityId,
        connectionArgs,
        startupCommand,
      }),
    );
  });
}
