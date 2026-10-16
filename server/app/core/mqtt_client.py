import asyncio
import datetime
import json
import logging
import threading
import time
from typing import Any, Dict, Optional
import paho.mqtt.client as mqtt
from sqlalchemy import delete, select

from server.app.core.automation_engine import process_telemetry_automations
from server.app.core.config import settings
from server.app.core.database import AsyncSessionLocal
from server.app.core.device_queue import device_queue
from server.app.core.ws_manager import ws_manager
from server.app.models.automation import NotificationLog
from server.app.models.device import Channel, Device, TelemetryLog

logger = logging.getLogger("rumah.mqtt")


class MqttService:
    def __init__(self):
        self.client: Optional[mqtt.Client] = None
        self._connected = False
        self._loop_thread: Optional[threading.Thread] = None
        self._running = False
        self.loop: Optional[asyncio.AbstractEventLoop] = None

    def start(self, event_loop: asyncio.AbstractEventLoop):
        """Start MQTT client connection in background thread."""
        self.loop = event_loop
        self._running = True

        client_id = f"{settings.MQTT_CLIENT_ID}_{int(time.time())}"
        # Paho MQTT 2.x API
        try:
            self.client = mqtt.Client(
                callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
                client_id=client_id,
                clean_session=True,
            )
        except Exception:
            self.client = mqtt.Client(client_id=client_id)

        if settings.MQTT_USERNAME and settings.MQTT_PASSWORD:
            self.client.username_pw_set(settings.MQTT_USERNAME, settings.MQTT_PASSWORD)

        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_message = self._on_message

        self._loop_thread = threading.Thread(target=self._worker_thread, daemon=True)
        self._loop_thread.start()

    def _worker_thread(self):
        while self._running:
            try:
                logger.info(
                    "Connecting to MQTT broker at %s:%d...",
                    settings.MQTT_BROKER_HOST,
                    settings.MQTT_BROKER_PORT,
                )
                self.client.connect(
                    settings.MQTT_BROKER_HOST,
                    settings.MQTT_BROKER_PORT,
                    keepalive=60,
                )
                self.client.loop_forever()
            except Exception as e:
                self._connected = False
                logger.warning("MQTT connection failed (%s). Retrying in 5 seconds...", e)
                time.sleep(5)

    def stop(self):
        self._running = False
        if self.client:
            try:
                self.client.disconnect()
            except Exception:
                pass

    def _on_connect(self, client, userdata, flags, rc, properties=None):
        logger.info("Connected to MQTT broker with result code %s", rc)
        self._connected = True
        # Subscribe to all home and iot topics
        prefix = settings.MQTT_TOPIC_PREFIX
        for p in set([prefix, "home", "iot"]):
            client.subscribe(f"{p}/+/availability", qos=1)
            client.subscribe(f"{p}/+/state", qos=1)
            client.subscribe(f"{p}/+/status", qos=1)
            client.subscribe(f"{p}/+/event", qos=2)
            client.subscribe(f"{p}/+/ack", qos=1)

    def _on_disconnect(self, client, userdata, disconnect_flags_or_rc, properties=None):
        logger.warning("Disconnected from MQTT broker.")
        self._connected = False

    def _on_message(self, client, userdata, msg):
        topic = msg.topic
        payload_raw = msg.payload.decode("utf-8", errors="ignore")
        logger.debug("MQTT RX [%s]: %s", topic, payload_raw)

        # Jadwalkan penanganan asinkron di loop utama
        if self.loop and self.loop.is_running():
            asyncio.run_coroutine_threadsafe(
                self.handle_incoming_message(topic, payload_raw),
                self.loop,
            )

    async def handle_incoming_message(self, topic: str, payload_raw: str):
        parts = topic.split("/")
        if len(parts) < 3:
            return

        prefix = parts[0]
        device_id = parts[1]
        msg_type = parts[2]

        if prefix not in (settings.MQTT_TOPIC_PREFIX, "home", "iot"):
            return

        try:
            if msg_type == "availability":
                await self._handle_availability(device_id, payload_raw.strip().lower())
            elif msg_type in ("state", "status"):
                data = json.loads(payload_raw)
                await self._handle_state(device_id, data)
            elif msg_type == "event":
                data = json.loads(payload_raw)
                await self._handle_event(device_id, data)
            elif msg_type == "ack":
                data = json.loads(payload_raw)
                await self._handle_ack(device_id, data)
        except Exception as e:
            logger.error("Error processing MQTT message on %s: %s", topic, e)

    async def _handle_availability(self, device_id: str, status_str: str):
        is_online = status_str == "online"
        now = datetime.datetime.utcnow()

        async with AsyncSessionLocal() as db:
            query = select(Device).where(Device.id == device_id)
            res = await db.execute(query)
            device = res.scalar_one_or_none()
            if device:
                device.is_online = is_online
                device.last_seen_at = now
                if not is_online:
                    # Buat notifikasi jika perangkat offline
                    notif = NotificationLog(
                        device_id=device_id,
                        event_type="device_offline",
                        message=f"Perangkat '{device.name}' terputus dari jaringan.",
                        severity="warning",
                    )
                    db.add(notif)
                await db.commit()

        # Siarkan ke WebSocket klien
        await ws_manager.broadcast({
            "type": "availability",
            "device_id": device_id,
            "is_online": is_online,
            "timestamp": now.isoformat(),
        })

    async def _handle_state(self, device_id: str, data: Dict[str, Any]):
        now = datetime.datetime.utcnow()

        # Jika ada pair_code dari ESP32 via MQTT, daftarkan ke registry
        if data.get("pair_code"):
            device_queue.register_pair_code(
                pair_code=str(data["pair_code"]).strip(),
                device_id=device_id,
                device_key=data.get("device_key"),
                status=data.get("status") or data,
            )

        # Unpack status jika dikirim dalam bentuk status dict seperti esp32_thonny.py
        channels_data = data.get("channels", {})
        sensors_data = data.get("sensors", {}) or data.get("telemetry", {})

        if "status" in data and isinstance(data["status"], dict):
            st = data["status"]
            if not channels_data:
                channels_data = {
                    "lamp": bool(st.get("lamp")),
                    "lamp_tengah": bool(st.get("lamp_tengah")),
                    "lamp_dapur_tamu": bool(st.get("lamp_dapur_tamu")),
                    "lamp_kamar": bool(st.get("lamp_kamar")),
                    "relay": bool(st.get("relay")),
                    "relay_fan": bool(st.get("relay")),
                }
            if not sensors_data:
                sensors_data = {
                    "mq2": st.get("gas_raw", 0),
                    "ldr": st.get("ldr", 0),
                }

        async with AsyncSessionLocal() as db:
            query = select(Device).where(Device.id == device_id)
            res = await db.execute(query)
            device = res.scalar_one_or_none()
            if device:
                device.is_online = True
                device.last_seen_at = now

            # 1. Update status tiap kanal
            for ch_key, ch_val in channels_data.items():
                val_str = str(ch_val).lower() if isinstance(ch_val, bool) else str(ch_val)
                ch_query = select(Channel).where(Channel.device_id == device_id, Channel.channel_key == ch_key)
                ch_res = await db.execute(ch_query)
                channel = ch_res.scalar_one_or_none()
                if channel:
                    channel.current_value = val_str
                    channel.updated_at = now

            # 2. Simpan telemetri numerik sensor ke TelemetryLog
            for s_key, s_val in sensors_data.items():
                try:
                    num_val = float(s_val)
                    t_log = TelemetryLog(
                        device_id=device_id,
                        channel_key=s_key,
                        value_num=num_val,
                        created_at=now,
                    )
                    db.add(t_log)
                except (ValueError, TypeError):
                    pass

            await db.commit()

            # 3. Jalankan otomasi sederhana
            await process_telemetry_automations(
                db=db,
                device_id=device_id,
                sensors=sensors_data,
                channels=channels_data,
                mqtt_publisher=self.publish_command,
            )

        # Siarkan state ke WebSocket
        await ws_manager.broadcast({
            "type": "state",
            "device_id": device_id,
            "channels": channels_data,
            "sensors": sensors_data,
            "timestamp": now.isoformat(),
        })

    async def _handle_event(self, device_id: str, data: Dict[str, Any]):
        event_name = data.get("event", "unknown_event")
        val = data.get("value")
        severity = "critical" if "alarm" in event_name.lower() or "gas" in event_name.lower() else "info"
        msg_text = f"Peringatan! Kejadian {event_name} terdeteksi pada {device_id} (nilai: {val})"

        async with AsyncSessionLocal() as db:
            notif = NotificationLog(
                device_id=device_id,
                event_type=event_name,
                message=msg_text,
                severity=severity,
            )
            db.add(notif)
            await db.commit()

        await ws_manager.broadcast({
            "type": "event",
            "device_id": device_id,
            "event": event_name,
            "data": data,
            "severity": severity,
            "message": msg_text,
        })

    async def _handle_ack(self, device_id: str, data: Dict[str, Any]):
        cmd_id = data.get("command_id") or data.get("id")
        action = data.get("action") or ""
        if cmd_id:
            device_queue.ack_command(device_id, str(cmd_id), ok=data.get("ok", True))

        # S4: Jika ack konfirmasi reset diterima dari perangkat
        if "reset" in str(cmd_id).lower() or "reset" in str(action).lower() or data.get("reset"):
            from server.app.core.mqtt_auth import revoke_device_mqtt_credentials
            from server.app.api.deps import record_audit_log
            logger.info("Reset ACK received from device %s. Revoking MQTT credentials.", device_id)
            try:
                revoke_device_mqtt_credentials(device_id)
            except Exception as e:
                logger.warning("Error revoking MQTT creds for %s: %s", device_id, e)

            async with AsyncSessionLocal() as db:
                res = await db.execute(select(Device).where(Device.id == device_id))
                dev = res.scalar_one_or_none()
                if dev:
                    dev.reset_status = None
                    dev.is_online = False
                    await db.commit()

                await record_audit_log(
                    db=db,
                    action="device.reset_ack_received",
                    user_id=None,
                    username="system",
                    target_type="device",
                    target_id=device_id,
                    details={"reset_ack": True, "credentials_revoked": True},
                    ip_address="127.0.0.1",
                )

        await ws_manager.broadcast({
            "type": "ack",
            "device_id": device_id,
            "ack": data,
        })

    def publish_command(self, device_id: str, cmd_payload: Dict[str, Any]):
        """Publish command to home/{device_id}/cmd with QoS 1, NOT retained."""
        if not self.client or not self._connected:
            logger.warning("Cannot publish command: MQTT broker not connected")
            return False

        topic = f"{settings.MQTT_TOPIC_PREFIX}/{device_id}/cmd"
        payload_str = json.dumps(cmd_payload)
        info = self.client.publish(topic, payload_str, qos=1, retain=False)
        logger.info("MQTT TX [%s]: %s (mid=%s)", topic, payload_str, info.mid)
        return True

    async def cleanup_retention_data(self, retention_days: int = 90):
        """Purge telemetry older than retention_days."""
        threshold_date = datetime.datetime.utcnow() - datetime.timedelta(days=retention_days)
        async with AsyncSessionLocal() as db:
            stmt = delete(TelemetryLog).where(TelemetryLog.created_at < threshold_date)
            await db.execute(stmt)
            await db.commit()
            logger.info("Cleaned up telemetry older than %s", threshold_date)


mqtt_service = MqttService()
