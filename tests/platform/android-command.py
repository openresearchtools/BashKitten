#!/usr/bin/env python3
"""Run a local candidate fixture through the signed instrumentation/Termux IPC.

The fixture must emit one JSON result; redirect package output to a fixture log.
Requires a disposable device with initialized suite-signed Termux and test APKs.
"""
import argparse
import base64
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--device', required=True)
parser.add_argument('fixture', type=Path)
args = parser.parse_args()
encoded = base64.b64encode(args.fixture.read_bytes()).decode()
command = ['adb', '-s', args.device, 'shell', 'am', 'instrument', '-w', '-e', 'class',
           'com.bashkitten.SuiteIntegrationTest#candidateCommand', '-e', 'candidateCommand', encoded,
           'com.bashkitten.test/androidx.test.runner.AndroidJUnitRunner']
result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
print(result.stdout)
if result.returncode or 'OK (1 test)' not in result.stdout:
    raise SystemExit('Android candidate fixture failed')
