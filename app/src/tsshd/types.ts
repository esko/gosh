export type TsshdUdpMode = 'QUIC' | 'KCP';

export type TsshdConnectParams = {
  host: string;
  port: number;
  sessionKey: Uint8Array;
  clientId: number;
  serverId: number;
  proxyKey: Uint8Array;
  udpMode: TsshdUdpMode;
  serverInfo: TsshdServerInfo;
};

export type TsshdServerInfo = {
  ServerVer?: string;
  ProtoVer?: number;
  Port: number;
  Mode: string;
  Pass?: string;
  Salt?: string;
  ServerCert?: string;
  ClientCert?: string;
  ClientKey?: string;
  ProxyKey: string;
  ClientID: number;
  ServerID: number;
  ProxyMode?: string;
  MTU?: number;
};

export type TsshdBootstrapResult = {
  host: string;
  params: TsshdConnectParams;
};

export type TsshdClientEvent =
  | { type: 'output'; data: Uint8Array }
  | { type: 'status'; status: 'connecting' | 'connected' | 'disconnected' | 'error'; error?: string }
  | { type: 'stale' };

export type TsshdAuthPacket = {
  clientId: number;
  seq: number;
};

export const TSSHD_DEFAULT_PORT_RANGE = '61001-61999';
export const TSSHD_DEFAULT_HEARTBEAT_TIMEOUT_MS = 3_000;
export const TSSHD_DEFAULT_RECONNECT_TIMEOUT_MS = 15_000;
export const TSSHD_DEFAULT_ALIVE_TIMEOUT_MS = 10 * 24 * 60 * 60 * 1_000;
export const TSSHD_DEFAULT_UDP_MODE: TsshdUdpMode = 'KCP';
