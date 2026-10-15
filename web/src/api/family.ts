import { apiClient } from './client';

export interface FamilySettingsData {
  enabled: boolean;
  study_zone_enabled: boolean;
  study_gap_tolerance_minutes: number;
  late_night_enabled: boolean;
  late_night_start: string;
  late_night_end: string;
  late_night_min_minutes: number;
  fall_detection_enabled: boolean;
  fall_stationary_seconds: number;
  inactivity_enabled: boolean;
  inactivity_min_minutes: number;
  hazard_zone_enabled: boolean;
  allow_assistant_family_summary: boolean;
  stats_retention_days: number;
  events_retention_days: number;
  updated_at?: string;
}

export interface TransparencyData {
  status: string;
  ai_worker_status: 'online' | 'offline';
  disclaimer: string;
  active_features: {
    master_enabled: boolean;
    study_zone_monitoring: boolean;
    late_night_activity_monitoring: boolean;
    fall_detection_monitoring: boolean;
    inactivity_monitoring: boolean;
    hazard_zone_monitoring: boolean;
    assistant_integration: boolean;
  };
  monitored_cameras: Array<{ id: string; name: string; room_id: string }>;
  monitored_zones: Array<{ id: string; camera_id: string; name: string; zone_type: string }>;
}

export interface CameraZoneData {
  id: string;
  camera_id: string;
  name: string;
  zone_type: 'belajar' | 'umum' | 'berbahaya';
  polygon: number[][];
  created_at?: string;
}

export interface FamilyDailySummaryData {
  study_minutes: number;
  late_night_count: number;
  fall_incident_count: number;
  inactivity_count: number;
  hazard_alert_count: number;
  summary_text: string;
}

export interface FamilyEventItem {
  id: string;
  event_type: 'study_activity' | 'late_night' | 'fall_detected' | 'inactivity' | 'hazardous_zone';
  camera_id: string;
  room_id: string;
  title: string;
  description: string;
  severity: 'info' | 'warning' | 'critical';
  metadata: Record<string, any>;
  is_reviewed: boolean;
  created_at: string;
}

export const familyApi = {
  getTransparency: async (): Promise<TransparencyData> => {
    return apiClient<TransparencyData>('/api/family/transparency');
  },

  getSettings: async (): Promise<{ status: string; settings: FamilySettingsData }> => {
    return apiClient<{ status: string; settings: FamilySettingsData }>('/api/family/settings');
  },

  updateSettings: async (data: Partial<FamilySettingsData>): Promise<{ status: string; message: string }> => {
    return apiClient<{ status: string; message: string }>('/api/family/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  getZones: async (cameraId?: string): Promise<{ status: string; zones: CameraZoneData[] }> => {
    const url = cameraId ? `/api/family/zones?camera_id=${encodeURIComponent(cameraId)}` : '/api/family/zones';
    return apiClient<{ status: string; zones: CameraZoneData[] }>(url);
  },

  createZone: async (zone: {
    camera_id: string;
    name: string;
    zone_type: string;
    polygon: number[][];
  }): Promise<{ status: string; id: string; message: string }> => {
    return apiClient<{ status: string; id: string; message: string }>('/api/family/zones', {
      method: 'POST',
      body: JSON.stringify(zone),
    });
  },

  deleteZone: async (zoneId: string): Promise<{ status: string; message: string }> => {
    return apiClient<{ status: string; message: string }>(`/api/family/zones/${zoneId}`, {
      method: 'DELETE',
    });
  },

  getSummary: async (range: 'today' | 'week' = 'today'): Promise<any> => {
    return apiClient<any>(`/api/family/summary?range=${range}`);
  },

  getEvents: async (limit: number = 30): Promise<{ status: string; events: FamilyEventItem[] }> => {
    return apiClient<{ status: string; events: FamilyEventItem[] }>(`/api/family/events?limit=${limit}`);
  },

  reviewEvent: async (eventId: string): Promise<{ status: string; message: string }> => {
    return apiClient<{ status: string; message: string }>(`/api/family/events/${eventId}/review`, {
      method: 'PUT',
      body: JSON.stringify({}),
    });
  },

  clearAllData: async (): Promise<{ status: string; message: string }> => {
    return apiClient<{ status: string; message: string }>('/api/family/data?confirm=true', {
      method: 'DELETE',
    });
  },

  getInvitations: async (): Promise<{ status: string; invitations: FamilyInvitationItem[] }> => {
    return apiClient<{ status: string; invitations: FamilyInvitationItem[] }>('/api/family/invitations');
  },

  respondInvitation: async (
    invitationId: number,
    action: 'accept' | 'reject'
  ): Promise<{ status: string; message: string; family_id?: number }> => {
    return apiClient<{ status: string; message: string; family_id?: number }>(
      `/api/family/invitations/${invitationId}/respond`,
      {
        method: 'POST',
        body: JSON.stringify({ action }),
      }
    );
  },

  inviteMember: async (
    email: string
  ): Promise<{ status: string; message: string; invitation: FamilyInvitationItem }> => {
    return apiClient<{ status: string; message: string; invitation: FamilyInvitationItem }>('/api/family/invite', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  getMembers: async (): Promise<{ status: string; family_id: number; members: FamilyMemberItem[] }> => {
    return apiClient<{ status: string; family_id: number; members: FamilyMemberItem[] }>('/api/family/members');
  },

  getSentInvitations: async (): Promise<{ status: string; invitations: any[] }> => {
    return apiClient<{ status: string; invitations: any[] }>('/api/family/sent-invitations');
  },
};

export interface FamilyInvitationItem {
  id: number;
  inviter_id: number;
  inviter_name: string;
  inviter_email?: string;
  invitee_email: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at?: string;
}

export interface FamilyMemberItem {
  id: number;
  username: string;
  full_name?: string;
  email?: string;
  role: string;
  is_owner: boolean;
  created_at?: string;
}


