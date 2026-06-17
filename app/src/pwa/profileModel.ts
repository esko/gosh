import type { Profile } from '../settings/types';
import { getProfile, saveProfile } from '../storage/indexedDb';
import type { PwaConnectionSpec, RecentConnection } from './types';

const RECENTS_KEY = 'iwa-ssh-legacy-pwa-recents';

export function profileToSpec(profile: Profile): PwaConnectionSpec {
  return {
    protocol: profile.protocol ?? 'ssh',
    username: profile.username,
    hostname: profile.host,
    port: profile.port,
    args: [],
    argstr: profile.connectionArgs,
    profileId: profile.id,
    identityId: profile.identityId,
    startupCommand: profile.startupCommand,
  };
}

export function specTitle(spec: PwaConnectionSpec): string {
  const user = spec.username ? `${spec.username}@` : '';
  const port = spec.port && spec.port !== 22 ? `:${spec.port}` : '';
  return `${spec.protocol} ${user}${spec.hostname}${port}`;
}

export function specToQuery(spec: PwaConnectionSpec): string {
  const params = new URLSearchParams();
  params.set('protocol', spec.protocol);
  if (spec.username) params.set('username', spec.username);
  params.set('host', spec.hostname);
  if (spec.port) params.set('port', String(spec.port));
  if (spec.argstr) params.set('args', spec.argstr);
  if (spec.profileId) params.set('profile', spec.profileId);
  if (spec.identityId) params.set('identity', spec.identityId);
  if (spec.startupCommand) params.set('startup', spec.startupCommand);
  return params.toString();
}

export function specFromQuery(query: URLSearchParams): PwaConnectionSpec | null {
  const protocol = query.get('protocol') === 'mosh' ? 'mosh' : query.get('protocol') === 'echo' ? 'echo' : 'ssh';
  const hostname = query.get('host')?.trim();
  if (!hostname) return null;
  const port = Number(query.get('port') ?? '');
  return {
    protocol,
    username: query.get('username')?.trim() || undefined,
    hostname,
    port: Number.isFinite(port) && port > 0 ? port : protocol === 'ssh' ? 22 : undefined,
    args: [],
    argstr: query.get('args')?.trim() || undefined,
    profileId: query.get('profile')?.trim() || undefined,
    identityId: query.get('identity')?.trim() || undefined,
    startupCommand: query.get('startup')?.trim() || undefined,
  };
}

export function loadRecentConnections(): RecentConnection[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]');
    return Array.isArray(value) ? (value as RecentConnection[]).filter((item) => item.hostname).slice(0, 12) : [];
  } catch {
    return [];
  }
}

export async function recordConnection(spec: PwaConnectionSpec): Promise<void> {
  const now = Date.now();
  const recent: RecentConnection = { ...spec, title: specTitle(spec), connectedAt: now };
  const next = [recent, ...loadRecentConnections().filter((item) => connectionKey(item) !== connectionKey(spec))].slice(0, 12);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(next));

  if (spec.profileId) {
    await saveProfileLastConnected(spec.profileId, now);
  }
}

async function saveProfileLastConnected(profileId: string, lastConnectedAt: number): Promise<void> {
  const profile = await getProfile(profileId);
  if (!profile) return;
  await saveProfile({ ...profile, lastConnectedAt });
}

function connectionKey(spec: Pick<PwaConnectionSpec, 'protocol' | 'username' | 'hostname' | 'port'>): string {
  return `${spec.protocol}:${spec.username ?? ''}@${spec.hostname}:${spec.port ?? ''}`;
}
