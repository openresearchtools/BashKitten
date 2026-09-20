#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Install a recorded ARM64 build and retain independent-app device test evidence."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shlex
import subprocess
import tempfile
import uuid
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

    def command(*values, timeout=120, input=None):
        result = subprocess.run([*adb, *values], input=input, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
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
    if int(device["sdk"]) >= 33:
        command("shell", "pm", "grant", "org.openresearchtools.wildbuzzard",
                "android.permission.POST_NOTIFICATIONS")
    command("reverse", "tcp:8765", "tcp:8765")
    command("reverse", "tcp:9443", "tcp:9443")
    command("shell", "rm", "-rf", "/sdcard/Android/data/org.openresearchtools.wildbuzzard.probe/files/screenshots")
    suites = [] if args.onion_only else ["AgentBrowserTest", "CommandBrowserTest"]
    credential_name = None
    credential_collection = None
    failed_suites = []
    try:
        if args.onion_fixture:
            suites.append("OnionBrowserTest")
            destination = "/sdcard/Android/data/org.openresearchtools.wildbuzzard.probe/files"
            command("shell", "mkdir", "-p", destination)
            command("push", str(args.onion_fixture), destination + "/probe-fixture.json")
            fixture = json.loads(args.onion_fixture.read_text())
            credential_name = "wildbuzzard-test-" + uuid.uuid4().hex + ".auth_private"
            credential_data = fixture["onion"].removesuffix(".onion") + ":descriptor:x25519:" + fixture["key"] + "\n"
            if int(device["sdk"]) >= 29:
                # A raw adb push is not indexed by the scoped-storage Downloads picker.
                credential_collection = "content://media/external_primary/downloads"
                command("shell", "content", "insert", "--uri", credential_collection,
                        "--bind", "_display_name:s:" + credential_name,
                        "--bind", "mime_type:s:application/octet-stream", "--bind", "relative_path:s:Download/")
                row = command("shell", shlex.join(["content", "query", "--uri", credential_collection,
                              "--projection", "_id", "--where", "_display_name='" + credential_name + "'"]))
                match = re.search(r"\b_id=(\d+)", row)
                if not match:
                    raise RuntimeError("Android Downloads did not register the test enrollment file")
                command("shell", "content", "write", "--uri", credential_collection + "/" + match[1], input=credential_data)
            else:
                with tempfile.TemporaryDirectory(prefix="wildbuzzard-enrollment-") as temporary:
                    credential = Path(temporary) / credential_name
                    credential.write_text(credential_data)
                    credential.chmod(0o600)
                    command("push", str(credential), "/sdcard/Download/" + credential_name)
        for suite in suites:
            extra = ["-e", "credentialFile", credential_name] if suite == "OnionBrowserTest" else []
            result = command("shell", "am", "instrument", "-w", "-e", "class",
                             "org.openresearchtools.wildbuzzard.probe." + suite,
                             *extra,
                             "org.openresearchtools.wildbuzzard.probe.test/androidx.test.runner.AndroidJUnitRunner",
                             timeout=1200)
            (args.output / (suite + ".log")).write_text(result + "\n")
            report["tests"][suite] = bool(re.search(r"OK \(1 test\)", result)) and "FAILURES" not in result
            report_path.write_text(json.dumps(report, indent=2) + "\n")
            print(suite + (": PASS" if report["tests"][suite] else ": FAIL"), flush=True)
            if not report["tests"][suite]:
                failed_suites.append(suite)
    finally:
        if credential_collection:
            command("shell", shlex.join(["content", "delete", "--uri", credential_collection,
                    "--where", "_display_name='" + credential_name + "'"]))
        elif credential_name:
            command("shell", "rm", "-f", "/sdcard/Download/" + credential_name)
        log = command("logcat", "-d", "-v", "threadtime", "WildBuzzardProbe:I", "AndroidRuntime:E", "*:S")
        (args.output / "device-logcat.log").write_text(log + "\n")
        subprocess.run([*adb, "pull", "/sdcard/Android/data/org.openresearchtools.wildbuzzard.probe/files/screenshots",
                        str(args.output / "screenshots")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        report["finished"] = datetime.now(timezone.utc).isoformat()
        report_path.write_text(json.dumps(report, indent=2) + "\n")
    if failed_suites:
        raise RuntimeError("Device suites failed: " + ", ".join(failed_suites) + "; inspect " + str(args.output))


if __name__ == "__main__":
    main()
