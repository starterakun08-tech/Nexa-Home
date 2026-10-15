import { apiClient } from './client';

export interface ChannelItem {
  id: number;
  device_id?: string;
  channel_key: string;
  name: string;
  alias?: string | null;
  channel_type: 'switch' | 'relay' | 'gas_sensor' | 'light_sensor' | 'buzzer';
  current_value: string | null;
  unit: string | null;
  is_sensitive?: boolean;
  allowed_for_child?: boolean;
  updated_at?: string;
}

export interface DeviceItem {
  id: string;
  owner_id?: number | null;
  name: string;
  room: string;
  device_type: string;
  is_online: boolean;
  last_seen_at: string | null;
  ip_address: string | null;
  mqtt_username?: string;
  channels: ChannelItem[];
}

export interface TelemetryPoint {
  id: number;
  channel_key: string;
  value: number;
  created_at: string;
}

export interface AddDevicePayload {
  id: string;
  name: string;
  room: string;
  device_type?: string;
}

export interface AddDeviceResponse {
  status: string;
  message: string;
  device: {
    id: string;
    name: string;
    room: string;
    device_type: string;
  };
  mqtt_credentials: {
    broker_host: string;
    broker_port: number;
    topic_prefix: string;
    client_id: string;
    username: string;
    password: string;
  };
}

export interface ClaimDevicePayload {
  device_id: string;
  claim_token: string;
  name?: string;
  room?: string;
}

export interface ClaimDeviceResponse {
  status: string;
  message: string;
  device: {
    id: string;
    name: string;
    room: string;
    device_type: string;
    is_online: boolean;
  };
}

export const devicesApi = {
  getDevices: async (): Promise<DeviceItem[]> => {
    const res = await apiClient<{ status: string; devices: DeviceItem[] }>('/api/devices');
    return res.devices || [];
  },

  addDevice: (payload: AddDevicePayload) =>
    apiClient<AddDeviceResponse>('/api/devices', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  claimDevice: (payload: ClaimDevicePayload) =>
    apiClient<ClaimDeviceResponse>('/api/devices/claim', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteDevice: (deviceId: string) =>
    apiClient<{ status: string; message: string }>(`/api/devices/${deviceId}`, {
      method: 'DELETE',
    }),

  unbindDevice: (deviceId: string) =>
    apiClient<{ status: string; message: string }>(`/api/devices/${deviceId}/unbind`, {
      method: 'POST',
    }),

  sendCommand: (deviceId: string, channelKey: string, value: boolean | number | string) =>
    apiClient<{ status: string; cmd_id: string; current_value: string }>(
      `/api/devices/${deviceId}/cmd`,
      {
        method: 'POST',
        body: JSON.stringify({
          channel: channelKey,
          action: 'set',
          value,
        }),
      }
    ),

  getTelemetry: async (deviceId: string, channelKey?: string, limit: number = 50): Promise<TelemetryPoint[]> => {
    const query = channelKey ? `?channel_key=${channelKey}&limit=${limit}` : `?limit=${limit}`;
    const res = await apiClient<{ status: string; telemetry: TelemetryPoint[] }>(
      `/api/devices/${deviceId}/telemetry${query}`
    );
    return res.telemetry || [];
  },

  listAllChannels: async (): Promise<ChannelItem[]> => {
    const res = await apiClient<{ status: string; channels: ChannelItem[] }>('/api/channels');
    return res.channels || [];
  },

  updateChannel: (
    channelId: number,
    data: { name?: string; alias?: string; is_sensitive?: boolean; allowed_for_child?: boolean }
  ) =>
    apiClient<{ status: string; channel: ChannelItem }>(`/api/channels/${channelId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
};
