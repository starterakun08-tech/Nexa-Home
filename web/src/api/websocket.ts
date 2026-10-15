/**
 * WebSocket Realtime Client untuk Nexa Home
 * Menghubungkan ke /api/ws dengan auto-reconnect backoff.
 */

import { getMemoryToken } from './client';

export interface WebSocketMessage {
  type: string;
  device_id?: string;
  channels?: Record<string, any>;
  timestamp?: string;
  data?: any;
}

type MessageHandler = (msg: WebSocketMessage) => void;

class RealtimeService {
  private ws: WebSocket | null = null;
  private handlers: Set<MessageHandler> = new Set();
  private isReconnecting = false;
  private reconnectAttempts = 0;
  private pingInterval: any = null;

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const token = getMemoryToken();
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : '';
    const wsUrl = `${protocol}//${host}/api/ws${tokenQuery}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        // Kirim heartbeat ping setiap 25 detik
        clearInterval(this.pingInterval);
        this.pingInterval = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send('ping');
          }
        }, 25000);
      };

      this.ws.onmessage = (event) => {
        if (event.data === 'pong') return;
        try {
          const msg = JSON.parse(event.data);
          this.handlers.forEach((h) => h(msg));
        } catch {
          // Abaikan pesan bukan JSON
        }
      };

      this.ws.onclose = () => {
        clearInterval(this.pingInterval);
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.ws?.close();
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.isReconnecting) return;
    this.isReconnecting = true;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
    this.reconnectAttempts++;
    setTimeout(() => {
      this.isReconnecting = false;
      this.connect();
    }, delay);
  }

  subscribe(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.connect();
    }
    return () => {
      this.handlers.delete(handler);
    };
  }

  disconnect() {
    clearInterval(this.pingInterval);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.handlers.clear();
  }
}

export const realtimeService = new RealtimeService();
export const deviceWs = realtimeService;
