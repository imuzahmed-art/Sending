"""
3_wifi_satellite_engine.py
Physical-layer radio state verification and slope regression engine for Wi-Fi and Satellite interfaces.
"""

import re
import subprocess
from typing import Optional


def detect_active_hardware() -> tuple[str, Optional[str]]:
    """
    Validates physical radio state (PHY power & connected media).
    Returns ('WIFI' | 'CELLULAR' | 'NONE', adapter_name).
    """
    # 1. Inspect Wi-Fi adapter
    try:
        wifi_res = subprocess.run(
            ["netsh", "wlan", "show", "interfaces"],
            capture_output=True,
            text=True,
            check=False,
        )
        out = wifi_res.stdout
        if "There is no wireless interface" not in out:
            # Confirm radio is powered on (not in airplane mode)
            if not re.search(r"Hardware\s*:\s*Off|Software\s*:\s*Off", out, re.IGNORECASE):
                if re.search(r"State\s*:\s*connected", out, re.IGNORECASE):
                    name_match = re.search(r"^\s*Name\s*:\s*(.+)$", out, re.MULTILINE)
                    name = name_match.group(1).strip() if name_match else "Wi-Fi"
                    return "WIFI", name
    except Exception:
        pass

    # 2. Inspect Cellular modem
    try:
        mbn_res = subprocess.run(
            ["netsh", "mbn", "show", "interfaces"],
            capture_output=True,
            text=True,
            check=False,
        )
        out = mbn_res.stdout
        if "There is no Mobile Broadband interface" not in out and mbn_res.returncode == 0:
            if re.search(r"State\s*:\s*Connected", out, re.IGNORECASE):
                name_match = re.search(r"^\s*Name\s*:\s*(.+)$", out, re.MULTILINE)
                name = name_match.group(1).strip() if name_match else "Cellular"
                return "CELLULAR", name
    except Exception:
        pass

    return "NONE", None


def get_live_wifi_metrics() -> tuple[Optional[float], Optional[float]]:
    """Reads raw signal percentage and link rate from the Wi-Fi driver."""
    try:
        res = subprocess.run(
            ["netsh", "wlan", "show", "interfaces"],
            capture_output=True,
            text=True,
            check=True,
        )
        sig_match = re.search(r"Signal\s*:\s*(\d+)%", res.stdout, re.IGNORECASE)
        rx_match = re.search(r"Receive rate\s*\(Mbps\)\s*:\s*([\d\.]+)", res.stdout, re.IGNORECASE)

        signal_pct = float(sig_match.group(1)) if sig_match else None
        rx_rate = float(rx_match.group(1)) if rx_match else None
        return signal_pct, rx_rate
    except Exception:
        return None, None


def calculate_slope(values: list[float]) -> float:
    """Calculates linear regression slope (rate of degradation per sample)."""
    n = len(values)
    if n < 2:
        return 0.0
    x = list(range(n))
    x_mean = sum(x) / n
    y_mean = sum(values) / n
    numerator = sum((x[i] - x_mean) * (values[i] - y_mean) for i in range(n))
    denominator = sum((x[i] - x_mean) ** 2 for i in range(n))
    return numerator / denominator if denominator != 0 else 0.0