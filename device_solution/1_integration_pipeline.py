"""
1_integration_pipeline.py
Device A Multi-Interface Sentinel Coordinator.
Inspects physical L1/L2 transceiver states and routes telemetry through the appropriate engine.
"""

import socket
import time

from cellular_engine import CellularA2Engine, get_live_cellular_metrics
from wifi_satellite_engine import (
    calculate_slope,
    detect_active_hardware,
    get_live_wifi_metrics,
)

HELPER_IP = "10.0.0.10"  # Helper Device B Direct Ethernet IP
HELPER_PORT = 5005

WIFI_THRESHOLD_PCT = 60.0  # Proactive early handover threshold
WIFI_WINDOW_SIZE = 5


def send_handover_trigger(reason: str):
    """Dispatches UDP handover trigger to Helper Device B."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.sendto(b"TRIGGER_HANDOVER", (HELPER_IP, HELPER_PORT))
            print(f"\n[UDP SENT] Notification pushed to Helper B -> {HELPER_IP}:{HELPER_PORT} ({reason})")
    except Exception as err:
        print(f"\n[UDP Error] Failed to contact Helper Device B: {err}")


def main():
    wifi_history = []
    cell_engine = CellularA2Engine(threshold_pct=30.0, ttt_seconds=2, alpha=0.5)
    cooldown_until = 0.0

    print("=== Device A: Multi-Interface Hardware Integration Pipeline ===")
    print(f"Target Helper: {HELPER_IP}:{HELPER_PORT}\n")

    while True:
        now = time.time()
        hw_type, adapter_name = detect_active_hardware()

        # -------------------------------------------------------------
        # BRANCH 1: Wi-Fi or Satellite Terminal Active
        # -------------------------------------------------------------
        if hw_type == "WIFI":
            cell_engine.reset()
            sig_pct, rx_rate = get_live_wifi_metrics()

            if sig_pct is not None:
                wifi_history.append(sig_pct)
                if len(wifi_history) > WIFI_WINDOW_SIZE:
                    wifi_history.pop(0)

                print(f"[PHY: {adapter_name}] Signal: {sig_pct:4.1f}% | RX Rate: {rx_rate} Mbps", end="")

                # Proactive Trigger Condition (< 60% + Negative Slope)
                if sig_pct < WIFI_THRESHOLD_PCT and len(wifi_history) == WIFI_WINDOW_SIZE:
                    slope = calculate_slope(wifi_history)
                    print(f" | Slope: {slope:+5.2f}%/s", end="")

                    if slope < 0.0 and now > cooldown_until:
                        print("\n[!] Wi-Fi degrading below threshold with negative slope -> Triggering Helper B!")
                        send_handover_trigger("WIFI_SLOPE_DEGRADED")
                        cooldown_until = now + 6.0
                print()
            else:
                print(f"[PHY: {adapter_name}] Link up, waiting for signal telemetry...")

        # -------------------------------------------------------------
        # BRANCH 2: Cellular (4G/5G WWAN) Active
        # -------------------------------------------------------------
        elif hw_type == "CELLULAR":
            wifi_history.clear()
            raw_signal = get_live_cellular_metrics()

            if raw_signal is not None:
                status = cell_engine.step(raw_signal)
                filtered = cell_engine.filtered_signal or 0.0
                print(f"[PHY: {adapter_name}] Raw: {raw_signal:4.1f}% | L3 Filtered: {filtered:4.1f}% | State: {status}")

                if status == "TRIGGER_HANDOVER" and now > cooldown_until:
                    print("\n[!] Cellular A2 TTT expired -> Triggering Helper B!")
                    send_handover_trigger("CELLULAR_A2_EXPIRED")
                    cooldown_until = now + 6.0
            else:
                print(f"[PHY: {adapter_name}] Modem active, waiting for cellular signal...")

        # -------------------------------------------------------------
        # BRANCH 3: Hardware Offline
        # -------------------------------------------------------------
        else:
            print("[OFFLINE] No physical Wi-Fi or Cellular network card active.")
            wifi_history.clear()
            cell_engine.reset()

        time.sleep(1.0)


if __name__ == "__main__":
    main()