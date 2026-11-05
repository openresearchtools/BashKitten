#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Coordinate an app target and collect it through its exact direct release URL."""
import argparse
import importlib.util
import json
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('component_coordinator', HERE / 'remote-components.py')
coordinator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(coordinator)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('target', choices=('linux-amd64', 'linux-arm64', 'android', 'android-x86_64'))
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--force-rebuild', choices=('true', 'false'), default='false')
    parser.add_argument('--warm-gkrust', choices=('true', 'false'), default='false')
    args = parser.parse_args()
    native = {'android': 'termux-aarch64', 'android-x86_64': 'termux-x86_64'}.get(args.target, args.target)
    coordinator.build(native, force=args.force_rebuild == 'true', warm_gkrust=args.warm_gkrust == 'true')
    result = coordinator.application.restore(args.target, args.directory)
    if not result:
        raise ValueError('Builder finished without its exact application output')
    receipt = {key: result[key] for key in ('repository', 'manifestName', 'manifestSha256', 'url')}
    (Path(os.environ['RUNNER_TEMP']) / ('builder-' + args.target + '.json')).write_text(json.dumps(receipt, indent=2) + '\n')


if __name__ == '__main__':
    main()
