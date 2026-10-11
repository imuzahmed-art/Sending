"""
device_solution/2_cellular_engine.py
3GPP Layer-3 IIR Filter & Event A2 Redirection Engine for Mobile Broadband (WWAN).
"""

import re
import subprocess
from typing import Optional


class CellularA2Engine:
    """
    Implements 3GPP TS 36.331 Layer-3 IIR filtering:
    F_n = (1 - alpha) * F_{n-1} + alpha * M_n
    """

    def __init__(self, threshold_pct: float = 60.0, ttt_seconds: int = 1, alpha: float = 0.5):
        # 60.0% proactive early cell-edge threshold (matches the Sentinel line)
        self.threshold = threshold_pct
        self.ttt_required = ttt_seconds
        self.alpha = alpha

        self.filtered_signal: Optional[float] = None
        self.ttt_counter = 0

    def reset(self):
        self.filtered_signal = None
        self.ttt_counter = 0

    def step(self, raw_signal: Optional[float]) -> str:
        if raw_signal is None:
            return "NO_SIGNAL"

        # Apply 3GPP L3 IIR smoothing
        if self.filtered_signal is None:
            self.filtered_signal = raw_signal
        else:
            self.filtered_signal = (1.0 - self.alpha) * self.filtered_signal + self.alpha * raw_signal

        # Evaluate 3GPP Event A2 condition: Serving cell drops below threshold
        if self.filtered_signal <= self.threshold:
            self.ttt_counter += 1
            if self.ttt_counter >= self.ttt_required:
                return "TRIGGER_HANDOVER"
            return "MONITORING_TTT"
        else:
            self.ttt_counter = 0
            return "STABLE"


def get_live_cellular_metrics() -> Optional[float]:
    """Reads cellular modem signal percentage using netsh mbn."""
    try:
        res = subprocess.run(
            ["netsh", "mbn", "show", "connection", "interface=*"],
            capture_output=True,
            text=True,
            check=True,
        )
        sig_match = re.search(r"Signal\s*:\s*(\d+)%", res.stdout, re.IGNORECASE)
        if sig_match:
            return float(sig_match.group(1))
    except Exception:
        pass
    return None