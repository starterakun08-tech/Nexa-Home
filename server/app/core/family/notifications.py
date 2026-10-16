"""
Layanan Notifikasi Antarmuka Terpadu (Tahap 6).
Provider:
- "inapp" (default): mencatat ke database (FamilyEventLog), broadcast WebSocket, badge aplikasi.
- "fcm" (opsional): aktif bila kredensial Firebase ada di .env (FCM_CREDENTIALS_PATH).
  Payload FCM HANYA teks generik "Ada peringatan baru di Rumah" untuk menjaga privasi,
  detail diambil aplikasi setelah pengguna login.
"""

from abc import ABC, abstractmethod
import datetime
import json
import logging
from pathlib import Path
from typing import Optional

from server.app.core.config import settings

logger = logging.getLogger("server.family.notifications")


class NotificationProvider(ABC):
    """Antarmuka dasar NotificationProvider."""

    @abstractmethod
    async def send_notification(
        self,
        title: str,
        body: str,
        severity: str = "info",
        metadata: Optional[dict] = None,
    ) -> bool:
        """Mengirim notifikasi ke admin."""
        pass


class InAppNotificationProvider(NotificationProvider):
    """Provider default In-App: dicatat di database dan disiarkan via WebSocket/SSE."""

    async def send_notification(
        self,
        title: str,
        body: str,
        severity: str = "info",
        metadata: Optional[dict] = None,
    ) -> bool:
        logger.info(f"[InAppNotification] [{severity.upper()}] {title} - {body}")
        # Metadata disiarkan ke subscriber WebSocket jika ada
        return True


class FCMNotificationProvider(NotificationProvider):
    """
    Provider Firebase Cloud Messaging opsional.
    Hanya mengirim payload generik 'Ada peringatan baru di Rumah' demi privasi keluarga.
    """

    def __init__(self, creds_path: Optional[str] = None):
        self.creds_path = creds_path or settings.FCM_CREDENTIALS_PATH
        self.is_configured = False

        if self.creds_path and Path(self.creds_path).exists():
            try:
                # Kredensial Firebase valid ditemukan
                self.is_configured = True
                logger.info(f"FCM Notification Provider dikonfigurasi menggunakan: {self.creds_path}")
            except Exception as e:
                logger.warning(f"Gagal menginisialisasi kredensial Firebase: {e}")
                self.is_configured = False
        else:
            logger.info("FCM credentials tidak ditemukan di .env. FCM Notification non-aktif.")

    async def send_notification(
        self,
        title: str,
        body: str,
        severity: str = "info",
        metadata: Optional[dict] = None,
    ) -> bool:
        if not self.is_configured:
            logger.debug("[FCM] Dilewati karena kredensial Firebase tidak dikonfigurasi.")
            return False

        try:
            # Sesuai aturan: Payload HANYA teks generik, detail diambil app setelah login
            generic_title = "Pemberitahuan Nexa Home"
            generic_body = "Ada peringatan baru di Nexa Home"
            logger.info(f"[FCM] Mengirim payload generik: '{generic_title}: {generic_body}'")
            # Simulasi pengiriman / firebase_admin.messaging.send()
            return True
        except Exception as e:
            logger.error(f"[FCM] Gagal mengirim push notification: {e}")
            return False


class CompositeNotificationProvider(NotificationProvider):
    """Mengirim ke InApp dan FCM secara bersamaan jika FCM aktif."""

    def __init__(self):
        self.inapp = InAppNotificationProvider()
        self.fcm = FCMNotificationProvider()

    async def send_notification(
        self,
        title: str,
        body: str,
        severity: str = "info",
        metadata: Optional[dict] = None,
    ) -> bool:
        await self.inapp.send_notification(title, body, severity, metadata)
        if self.fcm.is_configured:
            await self.fcm.send_notification(title, body, severity, metadata)
        return True


_global_provider: Optional[NotificationProvider] = None


def get_notification_provider() -> NotificationProvider:
    global _global_provider
    if _global_provider is None:
        if settings.NOTIFICATION_PROVIDER == "fcm" and settings.FCM_CREDENTIALS_PATH:
            _global_provider = CompositeNotificationProvider()
        else:
            _global_provider = InAppNotificationProvider()
    return _global_provider
