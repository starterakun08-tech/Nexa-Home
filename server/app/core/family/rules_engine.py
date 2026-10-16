"""
Mesin Aturan Analitik Keluarga (Tahap 6).
Semua aturan menghasilkan angka dan catatan kejadian saja (tanpa gambar, tanpa pengenalan wajah).
1. Aktivitas di Zona Belajar: durasi duduk di zona belajar + toleransi jeda <= N menit. Laptop/buku hanya penanda tambahan.
2. Aktivitas larut malam: ada orang di ruang umum pada jam 23:00 - 04:30 >= N menit.
3. Kemungkinan jatuh: postur berubah ke berbaring lalu tidak bergerak >= N detik (default 30s).
4. Tidak bergerak lama: postur dan posisi tetap >= N menit (default 120m).
5. Orang di zona berbahaya: orang di zona berbahaya saat alarm gas aktif atau jam terlarang.
"""

from datetime import datetime, time, timezone
import json
import logging
from typing import Dict, List, Optional, Tuple
import uuid

import numpy as np
from sqlalchemy import select

from server.app.core.config import settings
from server.app.core.database import async_session_factory
from server.app.core.family.notifications import get_notification_provider
from server.app.core.family.zone_checker import is_person_in_zone
from server.app.models.camera import Camera
from server.app.models.family import CameraZone, FamilyDailySummary, FamilyEventLog, FamilySettings

logger = logging.getLogger("server.family.rules")


def parse_time_str(t_str: str) -> time:
    """Mengubah format 'HH:MM' ke datetime.time."""
    parts = t_str.strip().split(":")
    return time(int(parts[0]), int(parts[1]))


def is_time_between(now_time: time, start_time: time, end_time: time) -> bool:
    """Mengecek apakah waktu berada di antara start dan end (mendukung lintas tengah malam)."""
    if start_time <= end_time:
        return start_time <= now_time <= end_time
    else:  # Lintas tengah malam, misal 23:00 s.d. 04:30
        return now_time >= start_time or now_time <= end_time


class FamilyRulesEngine:
    """Mesin evaluasi aturan analitik keluarga real-time."""

    def __init__(self):
        # State per kamera/objek pelacakan
        # camera_id -> dict state
        self.study_states: Dict[str, dict] = {}
        self.late_night_states: Dict[str, dict] = {}
        self.fall_states: Dict[str, dict] = {}
        self.inactivity_states: Dict[str, dict] = {}

    async def evaluate_frame(
        self,
        camera_id: str,
        room_id: str,
        room_name: str,
        persons: List[dict],
        other_detections: List[dict],
        zones: List[CameraZone],
        current_settings: FamilySettings,
        now: Optional[datetime] = None,
        is_gas_alarm_active: bool = False,
    ) -> List[FamilyEventLog]:
        """
        Mengevaluasi satu frame deteksi terhadap 5 aturan analitik keluarga.
        """
        if not current_settings.enabled:
            return []

        if now is None:
            now = datetime.now(timezone.utc)

        events_generated: List[FamilyEventLog] = []

        # 1. ATURAN 1: Aktivitas di Zona Belajar
        if current_settings.study_zone_enabled and (current_settings.study_gap_tolerance_minutes or 5) > 0:
            study_event = await self._check_study_activity(
                camera_id, room_id, room_name, persons, other_detections, zones, current_settings, now
            )
            if study_event:
                events_generated.append(study_event)

        # 2. ATURAN 2: Aktivitas Larut Malam
        if current_settings.late_night_enabled and (current_settings.late_night_min_minutes or 15) > 0:
            ln_event = await self._check_late_night_activity(
                camera_id, room_id, room_name, persons, other_detections, current_settings, now
            )
            if ln_event:
                events_generated.append(ln_event)

        # 3. ATURAN 3: Kemungkinan Jatuh
        if current_settings.fall_detection_enabled and (current_settings.fall_stationary_seconds or 30) > 0:
            fall_event = await self._check_fall_detection(
                camera_id, room_id, room_name, persons, current_settings, now
            )
            if fall_event:
                events_generated.append(fall_event)

        # 4. ATURAN 4: Tidak Bergerak Lama
        if current_settings.inactivity_enabled and (current_settings.inactivity_min_minutes or 120) > 0:
            inac_event = await self._check_inactivity(
                camera_id, room_id, room_name, persons, current_settings, now
            )
            if inac_event:
                events_generated.append(inac_event)

        # 5. ATURAN 5: Orang di Zona Berbahaya
        if current_settings.hazard_zone_enabled:
            hazard_event = await self._check_hazardous_zone(
                camera_id, room_id, room_name, persons, zones, is_gas_alarm_active, current_settings, now
            )
            if hazard_event:
                events_generated.append(hazard_event)

        return events_generated

    # -------------------------------------------------------------------------
    # ATURAN 1: ZONA BELAJAR
    # -------------------------------------------------------------------------
    async def _check_study_activity(
        self,
        camera_id: str,
        room_id: str,
        room_name: str,
        persons: List[dict],
        other_detections: List[dict],
        zones: List[CameraZone],
        fam_settings: FamilySettings,
        now: datetime,
    ) -> Optional[FamilyEventLog]:
        study_zones = [z for z in zones if z.zone_type == "belajar"]
        if not study_zones:
            return None

        state = self.study_states.setdefault(camera_id, {
            "is_active": False,
            "session_start": None,
            "last_seen": None,
            "active_seconds": 0.0,
            "laptop_detected": False,
            "book_detected": False,
            "zone_id": None,
            "zone_name": None,
        })

        gap_tolerance_sec = fam_settings.study_gap_tolerance_minutes * 60

        # Cari apakah ada orang duduk di salah satu zona belajar
        person_studying = False
        target_zone = None

        for p in persons:
            posture = p.get("posture")
            bbox = p.get("bbox")
            if posture == "duduk" and bbox:
                for z in study_zones:
                    try:
                        poly = json.loads(z.polygon_json)
                    except Exception:
                        poly = []
                    if is_person_in_zone(bbox, poly):
                        person_studying = True
                        target_zone = z
                        break
            if person_studying:
                break

        # Cek penanda tambahan (laptop / buku) di sekitar frame
        has_laptop = any(d.get("class_name") == "laptop" for d in other_detections)
        has_book = any(d.get("class_name") == "book" for d in other_detections)

        if person_studying and target_zone:
            if not state["is_active"]:
                # Mulai sesi baru
                state["is_active"] = True
                state["session_start"] = now
                state["last_seen"] = now
                state["active_seconds"] = 1.0
                state["laptop_detected"] = has_laptop
                state["book_detected"] = has_book
                state["zone_id"] = target_zone.id
                state["zone_name"] = target_zone.name
            else:
                # Lanjutkan sesi yang ada
                dt = (now - state["last_seen"]).total_seconds()
                state["active_seconds"] += max(0.5, min(dt, float(gap_tolerance_sec)))
                state["last_seen"] = now
                if has_laptop:
                    state["laptop_detected"] = True
                if has_book:
                    state["book_detected"] = True
            return None
        else:
            # Tidak ada yang belajar di frame ini
            if state["is_active"]:
                gap = (now - state["last_seen"]).total_seconds()
                if gap > gap_tolerance_sec:
                    # Sesi belajar selesai (melewati batas toleransi jeda)
                    session_duration = (state["last_seen"] - (state["session_start"] or state["last_seen"])).total_seconds()
                    total_minutes = max(1, int(session_duration / 60.0))
                    zname = state["zone_name"] or "Zona Belajar"
                    laptop_flag = state["laptop_detected"]
                    book_flag = state["book_detected"]
                    zid = state["zone_id"]

                    # Reset state
                    state["is_active"] = False
                    state["session_start"] = None
                    state["last_seen"] = None
                    state["active_seconds"] = 0.0

                    if total_minutes >= 1:
                        meta = {
                            "duration_minutes": total_minutes,
                            "laptop_detected": laptop_flag,
                            "book_detected": book_flag,
                        }
                        desc_parts = [f"Aktivitas duduk di {zname} ({room_name}) selama {total_minutes} menit."]
                        if laptop_flag or book_flag:
                            items = []
                            if laptop_flag:
                                items.append("laptop")
                            if book_flag:
                                items.append("buku")
                            desc_parts.append(f"Penanda tambahan terdeteksi: {', '.join(items)}.")

                        event = FamilyEventLog(
                            id=str(uuid.uuid4()),
                            event_type="study_activity",
                            camera_id=camera_id,
                            room_id=room_id,
                            zone_id=zid,
                            title=f"Aktivitas di {zname}",
                            description=" ".join(desc_parts),
                            severity="info",
                            metadata_json=json.dumps(meta),
                            created_at=now,
                        )
                        return event
            return None

    # -------------------------------------------------------------------------
    # ATURAN 2: AKTIVITAS LARUT MALAM
    # -------------------------------------------------------------------------
    async def _check_late_night_activity(
        self,
        camera_id: str,
        room_id: str,
        room_name: str,
        persons: List[dict],
        other_detections: List[dict],
        fam_settings: FamilySettings,
        now: datetime,
    ) -> Optional[FamilyEventLog]:
        start_t = parse_time_str(fam_settings.late_night_start)
        end_t = parse_time_str(fam_settings.late_night_end)

        # Ubah ke waktu lokal (WIB UTC+7) jika tzinfo UTC
        now_local = now.astimezone() if now.tzinfo else now
        current_t = now_local.time()

        if not is_time_between(current_t, start_t, end_t):
            if camera_id in self.late_night_states:
                del self.late_night_states[camera_id]
            return None

        state = self.late_night_states.setdefault(camera_id, {
            "first_seen": None,
            "last_seen": None,
            "has_notified": False,
            "phone_detected": False,
        })

        has_phone = any(d.get("class_name") == "cell phone" for d in other_detections)

        if len(persons) > 0:
            if state["first_seen"] is None:
                state["first_seen"] = now
                state["last_seen"] = now
                state["phone_detected"] = has_phone
            else:
                state["last_seen"] = now
                if has_phone:
                    state["phone_detected"] = True

            duration_min = int((now - state["first_seen"]).total_seconds() / 60.0)

            if duration_min >= fam_settings.late_night_min_minutes and not state["has_notified"]:
                state["has_notified"] = True
                time_str = now_local.strftime("%H:%M")

                desc_parts = [f"Ada aktivitas di {room_name} pukul {time_str} selama {duration_min} menit."]
                if state["phone_detected"]:
                    desc_parts.append("HP terdeteksi.")
                else:
                    desc_parts.append("Keterangan: deteksi HP sering terlewat.")

                desc = " ".join(desc_parts)
                event = FamilyEventLog(
                    id=str(uuid.uuid4()),
                    event_type="late_night",
                    camera_id=camera_id,
                    room_id=room_id,
                    title="Aktivitas Larut Malam",
                    description=desc,
                    severity="warning",
                    metadata_json=json.dumps({
                        "duration_minutes": duration_min,
                        "phone_detected": state["phone_detected"],
                        "time": time_str,
                    }),
                    created_at=now,
                )

                # Kirim notifikasi
                provider = get_notification_provider()
                await provider.send_notification("Aktivitas Larut Malam", desc, severity="warning")
                return event
        else:
            # Tidak ada orang
            if state["last_seen"] and (now - state["last_seen"]).total_seconds() > 300:
                self.late_night_states[camera_id] = {
                    "first_seen": None,
                    "last_seen": None,
                    "has_notified": False,
                    "phone_detected": False,
                }
        return None

    # -------------------------------------------------------------------------
    # ATURAN 3: KEMUNGKINAN JATUH
    # -------------------------------------------------------------------------
    async def _check_fall_detection(
        self,
        camera_id: str,
        room_id: str,
        room_name: str,
        persons: List[dict],
        fam_settings: FamilySettings,
        now: datetime,
    ) -> Optional[FamilyEventLog]:
        state = self.fall_states.setdefault(camera_id, {
            "lying_since": None,
            "last_pos": None,
            "has_notified": False,
        })

        lying_person = next((p for p in persons if p.get("posture") == "berbaring"), None)

        if lying_person:
            foot_pos = lying_person.get("foot_point", (0.0, 0.0))
            if state["lying_since"] is None:
                state["lying_since"] = now
                state["last_pos"] = foot_pos
            else:
                # Cek pergerakan (diam jika perpindahan < 30 px)
                prev_pos = state["last_pos"] or foot_pos
                dist = np.sqrt((foot_pos[0] - prev_pos[0]) ** 2 + (foot_pos[1] - prev_pos[1]) ** 2)

                if dist < 30.0:
                    stationary_seconds = (now - state["lying_since"]).total_seconds()
                    if stationary_seconds >= fam_settings.fall_stationary_seconds and not state["has_notified"]:
                        state["has_notified"] = True

                        body_text = f"Kemungkinan ada yang jatuh di {room_name}, mohon dicek"
                        event = FamilyEventLog(
                            id=str(uuid.uuid4()),
                            event_type="fall_detected",
                            camera_id=camera_id,
                            room_id=room_id,
                            title="Kemungkinan Jatuh",
                            description=body_text,
                            severity="critical",
                            metadata_json=json.dumps({
                                "stationary_seconds": int(stationary_seconds),
                                "room_name": room_name,
                            }),
                            created_at=now,
                        )

                        # Kirim notifikasi prioritas tinggi langsung (tanpa menunggu klip video selesai di-encode!)
                        provider = get_notification_provider()
                        await provider.send_notification("Kemungkinan Jatuh", body_text, severity="critical")
                        return event
                else:
                    # Ada pergerakan signifikan, update posisi
                    state["last_pos"] = foot_pos
        else:
            # Orang berdiri atau tidak ada orang
            if state["lying_since"] is not None:
                state["lying_since"] = None
                state["last_pos"] = None
                state["has_notified"] = False

        return None

    # -------------------------------------------------------------------------
    # ATURAN 4: TIDAK BERGERAK LAMA
    # -------------------------------------------------------------------------
    async def _check_inactivity(
        self,
        camera_id: str,
        room_id: str,
        room_name: str,
        persons: List[dict],
        fam_settings: FamilySettings,
        now: datetime,
    ) -> Optional[FamilyEventLog]:
        start_t = parse_time_str(fam_settings.inactivity_start)
        end_t = parse_time_str(fam_settings.inactivity_end)

        now_local = now.astimezone() if now.tzinfo else now
        current_t = now_local.time()

        if not is_time_between(current_t, start_t, end_t):
            return None

        state = self.inactivity_states.setdefault(camera_id, {
            "stationary_since": None,
            "last_pos": None,
            "has_notified": False,
        })

        if len(persons) == 1:
            p = persons[0]
            foot_pos = p.get("foot_point", (0.0, 0.0))

            if state["stationary_since"] is None:
                state["stationary_since"] = now
                state["last_pos"] = foot_pos
            else:
                prev_pos = state["last_pos"] or foot_pos
                dist = np.sqrt((foot_pos[0] - prev_pos[0]) ** 2 + (foot_pos[1] - prev_pos[1]) ** 2)

                if dist < 25.0:
                    inactive_min = int((now - state["stationary_since"]).total_seconds() / 60.0)
                    if inactive_min >= fam_settings.inactivity_min_minutes and not state["has_notified"]:
                        state["has_notified"] = True

                        body_text = f"Tidak ada pergerakan signifikan di {room_name} selama {inactive_min} menit."
                        event = FamilyEventLog(
                            id=str(uuid.uuid4()),
                            event_type="inactivity",
                            camera_id=camera_id,
                            room_id=room_id,
                            title="Tidak Bergerak Lama",
                            description=body_text,
                            severity="info",
                            metadata_json=json.dumps({"inactive_minutes": inactive_min}),
                            created_at=now,
                        )

                        provider = get_notification_provider()
                        await provider.send_notification("Aktivitas Keluarga", body_text, severity="info")
                        return event
                else:
                    # Posisi berubah, reset
                    state["stationary_since"] = now
                    state["last_pos"] = foot_pos
                    state["has_notified"] = False
        else:
            state["stationary_since"] = None
            state["last_pos"] = None
            state["has_notified"] = False

        return None

    # -------------------------------------------------------------------------
    # ATURAN 5: ORANG DI ZONA BERBAHAYA
    # -------------------------------------------------------------------------
    async def _check_hazardous_zone(
        self,
        camera_id: str,
        room_id: str,
        room_name: str,
        persons: List[dict],
        zones: List[CameraZone],
        is_gas_alarm_active: bool,
        fam_settings: FamilySettings,
        now: datetime,
    ) -> Optional[FamilyEventLog]:
        hazard_zones = [z for z in zones if z.zone_type == "berbahaya"]
        if not hazard_zones or not persons:
            return None

        # Evaluasi apakah ada orang di zona berbahaya
        for p in persons:
            bbox = p.get("bbox")
            if not bbox:
                continue

            for hz in hazard_zones:
                try:
                    poly = json.loads(hz.polygon_json)
                except Exception:
                    poly = []

                if is_person_in_zone(bbox, poly):
                    # Terdeteksi di zona berbahaya! Cek kondisi pemicu:
                    # Pemicu 1: Alarm gas aktif
                    # Pemicu 2: Jam terlarang yang dikonfigurasi
                    is_restricted_time = False
                    if fam_settings.hazard_restricted_hours:
                        try:
                            s_str, e_str = fam_settings.hazard_restricted_hours.split("-")
                            now_t = now.time()
                            is_restricted_time = is_time_between(now_t, parse_time_str(s_str), parse_time_str(e_str))
                        except Exception:
                            pass

                    if is_gas_alarm_active or is_restricted_time:
                        reason = "alarm gas aktif" if is_gas_alarm_active else "jam dilarang"
                        body_text = f"Peringatan: Ada aktivitas di zona berbahaya ({hz.name}) di {room_name} saat {reason}!"

                        event = FamilyEventLog(
                            id=str(uuid.uuid4()),
                            event_type="hazardous_zone",
                            camera_id=camera_id,
                            room_id=room_id,
                            zone_id=hz.id,
                            title="Aktivitas di Zona Berbahaya",
                            description=body_text,
                            severity="critical",
                            metadata_json=json.dumps({"zone_name": hz.name, "reason": reason}),
                            created_at=now,
                        )

                        provider = get_notification_provider()
                        await provider.send_notification("Zona Berbahaya", body_text, severity="critical")
                        return event
        return None


# -----------------------------------------------------------------------------
# TEMPLATE RINGKASAN LOKAL TANPA LLM (Keputusan 4)
# -----------------------------------------------------------------------------
async def generate_local_family_summary(date_str: str) -> FamilyDailySummary:
    """
    Menghasilkan ringkasan harian keluarga dari template lokal murni tanpa LLM.
    Menyimpan atau memperbarui data di tabel family_daily_summaries.
    """
    async with async_session_factory() as db:
        # Ambil kejadian pada tanggal tersebut
        stmt = select(FamilyEventLog).where(
            FamilyEventLog.created_at.like(f"{date_str}%")
        )
        logs = (await db.execute(stmt)).scalars().all()

        total_study_minutes = 0
        study_sessions = 0
        late_night_count = 0
        fall_count = 0
        inactivity_count = 0
        hazard_count = 0

        for l in logs:
            if l.event_type == "study_activity":
                study_sessions += 1
                try:
                    meta = json.loads(l.metadata_json)
                    total_study_minutes += meta.get("duration_minutes", 0)
                except Exception:
                    pass
            elif l.event_type == "late_night":
                late_night_count += 1
            elif l.event_type == "fall_detected":
                fall_count += 1
            elif l.event_type == "inactivity":
                inactivity_count += 1
            elif l.event_type == "hazardous_zone":
                hazard_count += 1

        hours = total_study_minutes // 60
        mins = total_study_minutes % 60

        summary_lines = [
            f"Ringkasan Aktivitas Keluarga Tanggal {date_str}:",
            f"- Total aktivitas di Zona Belajar: {hours} jam {mins} menit ({study_sessions} sesi).",
            f"- Aktivitas larut malam di ruang umum: {late_night_count} kejadian tercatat.",
            f"- Kejadian kemungkinan jatuh: {fall_count} kejadian.",
            f"- Kejadian tidak bergerak lama: {inactivity_count} kejadian.",
            f"- Peringatan di zona berbahaya: {hazard_count} kejadian.",
            "Catatan: Ringkasan dibuat dari analitik sensor ruang umum tanpa pengenalan wajah."
        ]
        summary_text = "\n".join(summary_lines)

        stmt_exist = select(FamilyDailySummary).where(FamilyDailySummary.date == date_str)
        existing = (await db.execute(stmt_exist)).scalar_one_or_none()

        if existing:
            existing.study_minutes = total_study_minutes
            existing.late_night_count = late_night_count
            existing.fall_incident_count = fall_count
            existing.inactivity_count = inactivity_count
            existing.hazard_alert_count = hazard_count
            existing.summary_text = summary_text
            summary_record = existing
        else:
            summary_record = FamilyDailySummary(
                id=str(uuid.uuid4()),
                date=date_str,
                study_minutes=total_study_minutes,
                late_night_count=late_night_count,
                fall_incident_count=fall_count,
                inactivity_count=inactivity_count,
                hazard_alert_count=hazard_count,
                summary_text=summary_text,
            )
            db.add(summary_record)

        await db.commit()
        return summary_record


family_rules_engine = FamilyRulesEngine()
