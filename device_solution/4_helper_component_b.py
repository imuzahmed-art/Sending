"""
4_helper_component_b.py
Helper Device B (Auxiliary Hardware Controller).
Listens for handover triggers over UDP, scans visible networks, filters against saved profiles,
and evaluates candidates using TOPSIS Multi-Criteria Decision Making (pymcdm).
"""

import re
import socket
import subprocess
import numpy as np
from pymcdm.methods import TOPSIS

LISTEN_IP = "0.0.0.0"
LISTEN_PORT = 5005

# TOPSIS Configuration: [Signal (0.50), Security (0.30), Band (0.20)]
MCDM_WEIGHTS = np.array([0.50, 0.30, 0.20])
MCDM_CRITERIA_TYPES = np.array([1, 1, 1])  # All benefit criteria


def get_saved_profiles() -> set[str]:
    """Retrieves all Wi-Fi profiles stored with credentials on Windows."""
    try:
        res = subprocess.run(
            ["netsh", "wlan", "show", "profiles"],
            capture_output=True,
            text=True,
            check=True,
        )
        return {p.strip() for p in re.findall(r"All User Profile\s*:\s*(.*)", res.stdout)}
    except Exception as err:
        print(f"[Profile Query Error] {err}")
        return set()


def scan_visible_networks(saved_profiles: set[str]) -> list[dict]:
    """Scans visible networks and filters candidates that match saved profiles."""
    try:
        subprocess.run(["netsh", "wlan", "show", "networks", "mode=bssid"], capture_output=True, text=True)
        res = subprocess.run(
            ["netsh", "wlan", "show", "networks", "mode=bssid"],
            capture_output=True,
            text=True,
            check=True,
        )
    except Exception as err:
        print(f"[Scan Error] {err}")
        return []

    networks = []
    current_net = {}

    for line in res.stdout.splitlines():
        line = line.strip()
        if line.startswith("SSID"):
            match = re.search(r"SSID\s+\d+\s*:\s*(.+)", line)
            if match:
                current_net = {"ssid": match.group(1).strip()}
        elif "Signal" in line and current_net:
            match = re.search(r"Signal\s*:\s*(\d+)%", line)
            if match:
                current_net["signal"] = float(match.group(1))
        elif "Authentication" in line and current_net:
            auth = line.split(":")[-1].strip().upper()
            current_net["security_score"] = 3.0 if "WPA3" in auth else (2.0 if "WPA2" in auth else 1.0)
        elif "Band" in line and current_net:
            band = line.split(":")[-1].strip()
            current_net["band_score"] = 2.0 if ("5" in band or "6" in band) else 1.0

            if current_net.get("ssid") in saved_profiles:
                # Avoid duplicates from multi-BSSID networks
                if not any(n["ssid"] == current_net["ssid"] for n in networks):
                    networks.append(current_net)
            current_net = {}

    return networks


def rank_candidates_topsis(candidates: list[dict]) -> dict | None:
    """Computes TOPSIS relative closeness scores using pymcdm."""
    if not candidates:
        return None
    if len(candidates) == 1:
        candidates[0]["mcdm_score"] = 1.0
        return candidates[0]

    matrix = np.array(
        [[c["signal"], c["security_score"], c["band_score"]] for c in candidates],
        dtype=float,
    )

    topsis = TOPSIS()
    scores = topsis(matrix, MCDM_WEIGHTS, MCDM_CRITERIA_TYPES)

    for i, c in enumerate(candidates):
        c["mcdm_score"] = round(float(scores[i]), 4)

    return sorted(candidates, key=lambda x: x["mcdm_score"], reverse=True)[0]


def connect_to_network(ssid: str):
    """Switches the active Wi-Fi profile."""
    print(f"\n[Connecting] Switching adapter to profile '{ssid}'...")
    res = subprocess.run(["netsh", "wlan", "connect", f"name={ssid}"], capture_output=True, text=True)
    if "Connection request was completed successfully" in res.stdout:
        print(f"[Success] Switched link to '{ssid}'.")
    else:
        print(f"[Error] {res.stdout.strip()}")


def main():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((LISTEN_IP, LISTEN_PORT))

    saved_profiles = get_saved_profiles()
    print("=== Helper Component B: TOPSIS MCDM Handover Engine ===")
    print(f"Listening on UDP port {LISTEN_PORT}...")
    print(f"Registered saved profiles ({len(saved_profiles)}): {list(saved_profiles)}\n")

    while True:
        data, addr = sock.recvfrom(1024)
        msg = data.decode("utf-8").strip()
        if "TRIGGER_HANDOVER" in msg:
            print(f"\n[ALERT RECEIVED from {addr[0]}] Handover trigger detected. Starting network scan...")

            saved_profiles = get_saved_profiles()
            candidates = scan_visible_networks(saved_profiles)

            if not candidates:
                print("[-] No in-range networks found matching saved profiles.")
                continue

            print(f"[+] Found {len(candidates)} candidate(s):")
            for c in candidates:
                print(
                    f"    * {c['ssid']} | Signal: {c['signal']}% | Security: {c['security_score']} | Band: {c['band_score']}"
                )

            best = rank_candidates_topsis(candidates)
            if best:
                print(f"\n[MCDM Winner] -> {best['ssid']} (TOPSIS Score: {best['mcdm_score']})")
                connect_to_network(best["ssid"])


if __name__ == "__main__":
    main()