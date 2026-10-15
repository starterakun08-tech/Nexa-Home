from datetime import datetime, timezone
from typing import Optional
import uuid

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from server.app.core.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class CameraZone(Base):
    """Zona poligon kamera (Tahap 6). Belajar, Umum, atau Berbahaya."""
    __tablename__ = "camera_zones"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    camera_id: Mapped[str] = mapped_column(String(64), ForeignKey("cameras.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    zone_type: Mapped[str] = mapped_column(String(30), nullable=False, default="umum")  # belajar, umum, berbahaya
    polygon_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")  # [[x, y], ...] normalized 0.0-1.0
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    camera = relationship("Camera")


class FamilyEventLog(Base):
    """Kejadian analitik keluarga tanpa gambar dan tanpa pengenalan wajah (Tahap 6)."""
    __tablename__ = "family_event_logs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)  # study_activity, late_night, fall_detected, inactivity, hazardous_zone
    camera_id: Mapped[str] = mapped_column(String(64), ForeignKey("cameras.id", ondelete="CASCADE"), nullable=False, index=True)
    room_id: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    zone_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    title: Mapped[str] = mapped_column(String(150), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(String(20), default="info")  # info, warning, critical
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")
    is_reviewed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)

    camera = relationship("Camera")


class FamilyDailySummary(Base):
    """Ringkasan harian keluarga berbasis template lokal tanpa LLM (Tahap 6)."""
    __tablename__ = "family_daily_summaries"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    date: Mapped[str] = mapped_column(String(10), nullable=False, unique=True, index=True)  # YYYY-MM-DD
    study_minutes: Mapped[int] = mapped_column(Integer, default=0)
    late_night_count: Mapped[int] = mapped_column(Integer, default=0)
    fall_incident_count: Mapped[int] = mapped_column(Integer, default=0)
    inactivity_count: Mapped[int] = mapped_column(Integer, default=0)
    hazard_alert_count: Mapped[int] = mapped_column(Integer, default=0)
    summary_text: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class FamilySettings(Base):
    """Konfigurasi dan saklar fitur analitik keluarga (Tahap 6). Default semua MATI."""
    __tablename__ = "family_settings"

    id: Mapped[str] = mapped_column(String(30), primary_key=True, default="default")
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)  # Master switch
    study_zone_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    study_gap_tolerance_minutes: Mapped[int] = mapped_column(Integer, default=5)

    late_night_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    late_night_start: Mapped[str] = mapped_column(String(10), default="23:00")
    late_night_end: Mapped[str] = mapped_column(String(10), default="04:30")
    late_night_min_minutes: Mapped[int] = mapped_column(Integer, default=15)

    fall_detection_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    fall_stationary_seconds: Mapped[int] = mapped_column(Integer, default=30)

    inactivity_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    inactivity_min_minutes: Mapped[int] = mapped_column(Integer, default=120)

    hazard_zone_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    hazard_restricted_hours: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, default=None)

    allow_assistant_family_summary: Mapped[bool] = mapped_column(Boolean, default=False)  # Default MATI
    stats_retention_days: Mapped[int] = mapped_column(Integer, default=90)
    events_retention_days: Mapped[int] = mapped_column(Integer, default=30)

    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class FamilyInvitation(Base):
    """Undangan bergabung dengan keluarga dari pemilik perangkat / admin rumah."""
    __tablename__ = "family_invitations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    inviter_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    invitee_email: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")  # pending, accepted, rejected
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    inviter = relationship("User", foreign_keys=[inviter_id])

