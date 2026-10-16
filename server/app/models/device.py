import datetime
from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from server.app.core.database import Base


class Device(Base):
    __tablename__ = "devices"

    id = Column(String(50), primary_key=True, index=True)  # contoh: "esp32_utama"
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    name = Column(String(100), nullable=False)
    room = Column(String(50), nullable=False, default="Umum")
    device_type = Column(String(30), nullable=False, default="esp32")  # esp32, sensor_hub, etc.
    is_online = Column(Boolean, default=False, nullable=False)
    last_seen_at = Column(DateTime, nullable=True)
    ip_address = Column(String(45), nullable=True)
    mqtt_username = Column(String(50), nullable=True)
    mqtt_password_hash = Column(String(255), nullable=True)
    reset_status = Column(String(30), nullable=True)  # 'melepas', 'menunggu_reset'
    reset_requested_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)

    owner = relationship("User", foreign_keys=[owner_id])
    channels = relationship("Channel", back_populates="device", cascade="all, delete-orphan", lazy="selectin")


class Channel(Base):
    __tablename__ = "channels"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    device_id = Column(String(50), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    channel_key = Column(String(50), nullable=False)  # contoh: "lamp_tengah", "mq2", "ldr"
    name = Column(String(100), nullable=False)
    alias = Column(String(100), nullable=True)  # contoh: "lampu kamar", "kipas"
    is_sensitive = Column(Boolean, default=False, nullable=False)  # aksi butuh konfirmasi
    allowed_for_child = Column(Boolean, default=True, nullable=False)  # izin kontrol anak
    channel_type = Column(String(30), nullable=False)  # switch, relay, gas_sensor, light_sensor, buzzer
    current_value = Column(Text, nullable=True)  # "true", "false", "1450"
    unit = Column(String(20), nullable=True)  # "PPM", "raw", "%", etc.
    updated_at = Column(
        DateTime,
        default=datetime.datetime.utcnow,
        onupdate=datetime.datetime.utcnow,
        nullable=False,
    )

    device = relationship("Device", back_populates="channels")

    __table_args__ = (
        UniqueConstraint("device_id", "channel_key", name="uq_device_channel"),
    )


class TelemetryLog(Base):
    __tablename__ = "telemetry_logs"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    device_id = Column(String(50), index=True, nullable=False)
    channel_key = Column(String(50), index=True, nullable=False)
    value_num = Column(Float, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, index=True, nullable=False)
