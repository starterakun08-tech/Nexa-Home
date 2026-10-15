from pathlib import Path
from typing import Optional
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Base directory repo
BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent
DATA_DIR = BASE_DIR / "server" / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DEFAULT_DB_PATH = DATA_DIR / "rumah.db"

ENV_FILE = BASE_DIR / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE) if ENV_FILE.exists() else None,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    APP_ENV: str = "development"
    APP_DEBUG: bool = True
    SERVER_HOST: str = "0.0.0.0"
    SERVER_PORT: int = 8000
    SECRET_KEY: str = "default_insecure_development_secret_key_change_me_in_env_file"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    DATABASE_URL: str = f"sqlite+aiosqlite:///{DEFAULT_DB_PATH.as_posix()}"

    # Google OAuth2 & Public Domain
    BASE_PUBLIC_URL: str = "https://aujasena.my.id"
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: Optional[str] = None

    @field_validator("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", mode="before")
    @classmethod
    def clean_oauth_credentials(cls, v: object) -> str:
        if v is None:
            return ""
        s = str(v).strip()
        if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
            s = s[1:-1].strip()
        return s

    @field_validator("GOOGLE_REDIRECT_URI", mode="before")
    @classmethod
    def clean_oauth_redirect_uri(cls, v: object) -> Optional[str]:
        if v is None:
            return None
        s = str(v).strip()
        if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
            s = s[1:-1].strip()
        return s if s else None

    # SMTP Email Service
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "Nexa Home <noreply@aujasena.my.id>"
    SMTP_USE_TLS: bool = True

    # MQTT
    MQTT_BROKER_HOST: str = "127.0.0.1"
    MQTT_BROKER_PORT: int = 1883
    MQTT_USERNAME: str = "rumah_server"
    MQTT_PASSWORD: str = ""
    MQTT_CLIENT_ID: str = "rumah_core_server"
    MQTT_TOPIC_PREFIX: str = "home"

    # MediaMTX
    MEDIAMTX_API_URL: str = "http://127.0.0.1:9997"
    MEDIAMTX_RTSP_URL: str = "rtsp://127.0.0.1:8554"
    MEDIAMTX_WEBRTC_URL: str = "http://127.0.0.1:8889"

    # DeepSeek LLM
    DEEPSEEK_API_KEY: str = ""
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com"
    DEEPSEEK_KNOWN_MODELS: list[str] = ["deepseek-chat", "deepseek-reasoner"]
    DEEPSEEK_MODEL: str = "deepseek-chat"

    @field_validator("DEEPSEEK_MODEL")
    @classmethod
    def validate_deepseek_model(cls, v: str) -> str:
        import logging
        logger = logging.getLogger("server.config")
        known = getattr(cls, "DEEPSEEK_KNOWN_MODELS", ["deepseek-chat", "deepseek-reasoner"])
        if v and v not in known:
            logger.warning(
                f"[Config] Model DeepSeek '{v}' tidak terdaftar di DEEPSEEK_KNOWN_MODELS ({known}). "
                f"Model tidak dikenal tetap diizinkan untuk digunakan."
            )
        return v

    # Camera & Recording (Tahap 4 & 5)
    MEDIA_ENCRYPTION_KEY: str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    RECORDING_ENCRYPTION_KEY: Optional[str] = None
    CAMERA_ENCRYPTION_KEY: Optional[str] = None
    CAMERA_PAIRING_CODE_EXPIRE_MINUTES: int = 10
    CAMERA_MOTION_MAX_ACTIVE: int = 3
    CAMERA_MOTION_FPS: int = 2
    CAMERA_MOTION_WIDTH: int = 320
    CAMERA_MOTION_THRESHOLD: int = 25
    CAMERA_MOTION_MIN_AREA: int = 500
    CAMERA_PRE_ROLL_SECONDS: int = 3
    CAMERA_POST_ROLL_SECONDS: int = 3
    CAMERA_MAX_CLIP_SECONDS: int = 60
    RECORDING_STORAGE_DIR: str = str(DATA_DIR / "recordings")
    RECORDING_RETENTION_DAYS: int = 7
    RECORDING_MAX_DISK_MB: int = 10240
    RECORDING_MIN_FREE_DISK_MB: int = 500
    MEDIAMTX_BIN_PATH: str = "./tools/mediamtx/mediamtx.exe"
    FFMPEG_BIN_PATH: str = "ffmpeg"

    # Assistant & Cost Controls
    ASSISTANT_RATE_LIMIT_PER_MINUTE: int = 15
    ASSISTANT_MAX_TOKENS: int = 500
    ASSISTANT_DAILY_BUDGET_CENTS: float = 100.0
    ASSISTANT_DAILY_REQUEST_LIMIT: int = 200
    ASSISTANT_MAX_HISTORY_MESSAGES: int = 10

    # TTS
    TTS_PROVIDER: str = "edge-tts"
    EDGE_TTS_VOICE: str = "id-ID-ArdiNeural"
    PIPER_BIN_PATH: str = "./tools/piper/piper.exe"
    PIPER_MODEL_PATH: str = "server/data/models/piper/id_ID-news_tts-medium.onnx"
    PIPER_CONFIG_PATH: str = "server/data/models/piper/id_ID-news_tts-medium.onnx.json"
    TTS_CACHE_DIR: str = str(DATA_DIR / "tts_cache")
    TTS_MAX_TEXT_LENGTH: int = 500

    # AI Vision (Tahap 5)
    VISION_ENABLED: bool = True
    VISION_WORKER_ENABLED: bool = True
    VISION_MODEL_PATH: str = "server/data/models/yolo/yolo11n.onnx"
    VISION_POSE_MODEL_PATH: str = "server/data/models/yolo/yolo11n-pose.onnx"
    VISION_ONNX_THREADS: int = 2
    VISION_INPUT_SIZE: int = 640
    VISION_TARGET_FPS: int = 2
    VISION_CONFIDENCE_THRESHOLD: float = 0.35
    VISION_CLASS_THRESHOLDS: dict[str, float] = {
        "person": 0.35,
        "laptop": 0.35,
        "bottle": 0.20,
        "remote": 0.15,
        "cup": 0.15,
        "cell phone": 0.15,
        "backpack": 0.15,
        "handbag": 0.15,
        "book": 0.15,
    }
    VISION_TRACKABLE_CLASSES: list[str] = [
        "cell phone",
        "remote",
        "handbag",
        "backpack",
        "suitcase",
        "bottle",
        "cup",
        "laptop",
        "mouse",
        "keyboard",
        "book",
        "umbrella",
    ]
    VISION_ITEM_RETENTION_DAYS: int = 7
    VISION_MAX_ITEM_RECORDS: int = 50000
    VISION_HEARTBEAT_TIMEOUT_SECONDS: int = 15
    VISION_MOTION_TRIGGER_COOLDOWN_SECONDS: int = 5

    # Deteksi Benda Pasca-Gerakan (Tahap 5 Perbaikan 4)
    VISION_POST_MOTION_ENABLED: bool = True
    VISION_POST_MOTION_IDLE_SECONDS: int = 5
    VISION_POST_MOTION_MODEL_PATH: str = "server/data/models/yolo/yolo11s_640.onnx"
    VISION_POST_MOTION_CONFIDENCE: float = 0.15

    # Insight Keluarga / Family Analytics (Tahap 6) - Semua default MATI
    FAMILY_ENABLED: bool = False
    FAMILY_STUDY_GAP_MINUTES: int = 5
    FAMILY_LATE_NIGHT_START: str = "23:00"
    FAMILY_LATE_NIGHT_END: str = "04:30"
    FAMILY_LATE_NIGHT_MIN_MINUTES: int = 15
    FAMILY_FALL_STATIONARY_SECONDS: int = 30
    FAMILY_INACTIVITY_MINUTES: int = 120
    FAMILY_INACTIVITY_START: str = "08:00"
    FAMILY_INACTIVITY_END: str = "21:00"
    FAMILY_STATS_RETENTION_DAYS: int = 90
    FAMILY_EVENTS_RETENTION_DAYS: int = 30
    FAMILY_ALLOW_ASSISTANT_SUMMARY: bool = False
    NOTIFICATION_PROVIDER: str = "inapp"
    FCM_CREDENTIALS_PATH: Optional[str] = None


settings = Settings()

