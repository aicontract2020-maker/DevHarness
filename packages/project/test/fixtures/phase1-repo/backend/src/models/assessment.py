from sqlalchemy import Column, String, ForeignKey
from .base import Base

class Assessment(Base):
    __tablename__ = "kb_assessments"
    id = Column(String, primary_key=True)
    lesson_id = Column(String, ForeignKey("kb_lessons.id"), nullable=False)
