import datetime
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from server.app.core.database import Base


class ClaimSession(Base):
    __tablename__ = "claim_sessions"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    device_id = Column(String(50), nullable=False, index=True)
    code_hash = Column(String(64), nullable=False, index=True)
    qr_token_hash = Column(String(64), nullable=False, index=True)
    status = Column(String(20), nullable=False, default="aktif", index=True)  # 'aktif', 'terpakai', 'kedaluwarsa', 'dicabut'
    is_claimed = Column(Boolean, default=False, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False, index=True)
    used_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    used_at = Column(DateTime, nullable=True)

    user = relationship("User", foreign_keys=[used_by])
