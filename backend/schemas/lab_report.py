from typing import List, Optional
from pydantic import BaseModel


class LabTest(BaseModel):
    name: str
    value: float
    unit: str
    reference_low: Optional[float] = None
    reference_high: Optional[float] = None


class LabReport(BaseModel):
    report_date: Optional[str] = None
    tests: List[LabTest]


class ExtractedReport(BaseModel):
    report_id: str
    report_date: Optional[str] = None
    tests: List[LabTest]


class LabReportBatch(BaseModel):
    reports: List[ExtractedReport]
    summary: List[str]