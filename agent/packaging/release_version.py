"""A reproducible prerelease version shared by every build of one commit."""
from datetime import datetime, timezone
import subprocess


def nightly_version(product, repository):
    epoch = int(subprocess.check_output(
        ['git', 'log', '-1', '--format=%ct'], cwd=repository, text=True).strip())
    stamp = datetime.fromtimestamp(epoch, timezone.utc).strftime('%Y%m%d%H%M%S')
    return f'{product}~nightly.{stamp}'
