export type ConnectionStatus = 'starting' | 'online' | 'offline' | 'server-unavailable' | 'unsupported' | 'another-tab';

export function disconnectedStatus(networkOnline: boolean): ConnectionStatus {
  return networkOnline ? 'server-unavailable' : 'offline';
}

export const connectionLabels: Record<ConnectionStatus, string> = {
  starting: 'Connecting…', online: 'You’re online', offline: 'You’re offline',
  'server-unavailable': 'Server unavailable', unsupported: 'Browser not supported', 'another-tab': 'Active in another tab',
};

export const connectionHints: Record<ConnectionStatus, string> = {
  starting: 'Getting your device ready…', online: 'Ready to connect',
  offline: 'You’re offline. We’ll reconnect when your connection returns.',
  'server-unavailable': 'Cannot reach the NearDrop server. Your device may still have internet access. Try again shortly.',
  unsupported: 'Open NearDrop over HTTPS in a modern browser.',
  'another-tab': 'NearDrop is active in another tab. Reload here to reconnect.',
};
