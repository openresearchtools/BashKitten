#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Install a recorded ARM64 build and retain independent-app device test evidence."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
from datetime import datetime, timezone


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifacts", type=Path)
    parser.add_argument("--serial", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--onion-fixture", type=Path)
    parser.add_argument("--onion-only", action="store_true")
    args = parser.parse_args()
    if args.onion_only and not args.onion_fixture:
        parser.error("--onion-only requires --onion-fixture")
    args.output.mkdir(parents=True, exist_ok=True)
    adb = ["adb", "-s", args.serial]

    def command(*values, timeout=120):
        result = subprocess.run([*adb, *values], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
        if result.returncode:
            (args.output / "failed-command.log").write_text(result.stdout)
            raise RuntimeError(result.stdout.strip())
        return result.stdout.strip()

    manifest = json.loads((args.artifacts / "build-manifest.json").read_text())
    for name, expected in manifest["apks"].items():
        path = args.artifacts / name
        if path.parent != args.artifacts or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise RuntimeError("APK checksum or filename mismatch: " + name)
    if manifest["architecture"] != "arm64-v8a":
        raise RuntimeError("Expected an ARM64 build")
    device = {
        "abi": command("shell", "getprop", "ro.product.cpu.abi"),
        "product": command("shell", "getprop", "ro.product.name"),
        "android": command("shell", "getprop", "ro.build.version.release"),
        "sdk": command("shell", "getprop", "ro.build.version.sdk"),
        "page_size": command("shell", "getconf", "PAGESIZE"),
    }
    if device["abi"] != "arm64-v8a":
        raise RuntimeError("Device is not native ARM64: " + device["abi"])
    report = {"source": manifest["source"], "started": datetime.now(timezone.utc).isoformat(),
              "device": device, "apks": manifest["apks"], "tests": {}}
    report_path = args.output / "device-results.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    for role in ("browser", "agent_probe", "instrumentation"):
        name = manifest["roles"][role]
        if name not in manifest["apks"]:
            raise RuntimeError("Unrecorded APK role: " + role)
        if args.onion_only:
            package = {"browser": "org.openresearchtools.wildbuzzard",
                       "agent_probe": "org.openresearchtools.wildbuzzard.probe",
                       "instrumentation": "org.openresearchtools.wildbuzzard.probe.test"}[role]
            installed = command("shell", "pm", "path", package).removeprefix("package:")
            if "\n" in installed or not installed.startswith("/data/app/"):
                raise RuntimeError("Expected an installed standalone APK: " + package)
            if command("shell", "sha256sum", installed).split()[0] != manifest["apks"][name]:
                raise RuntimeError("Installed APK differs from the recorded build: " + package)
            result = "Retained matching installed APK and running browser process"
        else:
            result = command("install", "-r", str(args.artifacts / name), timeout=300)
        (args.output / (role + "-install.log")).write_text(result + "\n")
    command("reverse", "tcp:8765", "tcp:8765")
    command("reverse", "tcp:9443", "tcp:9443")
    suites = [] if args.onion_only else ["AgentBrowserTest", "CommandBrowserTest"]
    if args.onion_fixture:
        suites.append("OnionBrowserTest")
        destination = "/sdcard/Android/data/org.openresearchtools.wildbuzzard.probe/files"
        command("shell", "mkdir", "-p", destination)
        command("push", str(args.onion_fixture), destination + "/probe-fixture.json")
    try:
        for suite in suites:
            result = command("shell", "am", "instrument", "-w", "-e", "class",
                             "org.openresearchtools.wildbuzzard.probe." + suite,
                             "org.openresearchtools.wildbuzzard.probe.test/androidx.test.runner.AndroidJUnitRunner",
                             timeout=1200)
            (args.output / (suite + ".log")).write_text(result + "\n")
            report["tests"][suite] = bool(re.search(r"OK \(1 test\)", result)) and "FAILURES" not in result
            report_path.write_text(json.dumps(report, indent=2) + "\n")
            print(suite + (": PASS" if report["tests"][suite] else ": FAIL"), flush=True)
            if not report["tests"][suite]:
                raise RuntimeError("Device suite failed; inspect " + str(args.output / (suite + ".log")))
    finally:
        log = command("logcat", "-d", "-v", "threadtime", "WildBuzzardProbe:I", "AndroidRuntime:E", "*:S")
        (args.output / "device-logcat.log").write_text(log + "\n")
        subprocess.run([*adb, "pull", "/sdcard/Android/data/org.openresearchtools.wildbuzzard.probe/files/screenshots",
                        str(args.output / "screenshots")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        report["finished"] = datetime.now(timezone.utc).isoformat()
        report_path.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
