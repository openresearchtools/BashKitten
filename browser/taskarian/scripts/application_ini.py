# SPDX-License-Identifier: AGPL-3.0-or-later
"""Generate the current application data without changing the native ESR version."""
import configparser
from pathlib import Path
import re


def main(output, engine_ini, product_version):
    version = Path(product_version).read_text().strip()
    if not re.fullmatch(r"[1-9][0-9]*\.(?:0|[1-9][0-9]*)(?:\.[1-9][0-9]*)?", version):
        raise ValueError("Invalid Taskarian application version")
    application = configparser.RawConfigParser()
    application.optionxform = str
    application.read(engine_ini)
    if application.get("App", "Name") != "Taskarian":
        raise ValueError("Expected Taskarian native application data")
    application.set("App", "Version", version)
    application.write(output, space_around_delimiters=False)
