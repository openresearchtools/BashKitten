#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later

import argparse
import json
import pathlib
import re
import subprocess
import tempfile

import tomllib

ROOT = pathlib.Path(__file__).resolve().parents[2]
PRODUCT_VERSION = "bashkitten/config/version.txt"
PIN_FILE = "bashkitten/upstreams.toml"
OFFICIAL_REMOTE = "https://github.com/mozilla-firefox/firefox.git"
SOURCE_TAG_PREFIX = "refs/tags/bashkitten/firefox/"


class ReleaseError(Exception):
    pass


def git(repository, *arguments):
    result = subprocess.run(
        ["git", "-C", str(repository), *arguments],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode:
        raise ReleaseError(
            "\n".join(
                part.strip() for part in (result.stdout, result.stderr) if part.strip()
            )
            or f"git {arguments[0]} failed ({result.returncode})"
        )
    return result.stdout.strip()


def esr_parts(version):
    value = version.removesuffix("esr")
    if not re.fullmatch(
        r"[1-9][0-9]*\.(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)){0,2}", value
    ):
        raise ReleaseError(f"Invalid Firefox ESR version: {version}")
    parts = tuple(map(int, value.split(".")))
    return parts + (0,) if len(parts) == 2 else parts


def esr_version(version):
    parts = esr_parts(version)
    if len(parts) == 3 and parts[1:] == (0, 0):
        parts = parts[:2]
    return ".".join(map(str, parts)) + "esr"


def release_tag(version):
    return "FIREFOX_" + esr_version(version).replace(".", "_") + "_RELEASE"


def pins(repository):
    return tomllib.loads((repository / PIN_FILE).read_text(encoding="utf-8"))["firefox"]


def product_parts(version):
    if not re.fullmatch(r"[1-9][0-9]*\.(?:0|[1-9][0-9]*)(?:\.[1-9][0-9]*)?", version):
        raise ReleaseError(f"Invalid BashKitten version: {version}")
    return tuple(map(int, version.split(".")))


def next_product_version(current, firefox_version):
    product = product_parts(current)
    base = esr_parts(firefox_version)[:2]
    if base < product[:2]:
        raise ReleaseError("Cannot move BashKitten to an older Firefox release line")
    if base == product[:2]:
        base += ((product[2] if len(product) == 3 else 0) + 1,)
    return ".".join(map(str, base))


def validate_engine_versions(repository, version):
    for name, expected in (
        ("version.txt", version.removesuffix("esr")),
        ("version_display.txt", version),
    ):
        actual = (
            (repository / "browser/config" / name).read_text(encoding="utf-8").strip()
        )
        if actual != expected:
            raise ReleaseError("Firefox version files do not match the release pin")


def validate_versions(repository):
    firefox = pins(repository)
    version = firefox["version"]
    if version != esr_version(version) or firefox["ref"] != release_tag(version):
        raise ReleaseError("Firefox version and exact release tag do not match")
    for key in ("commit", "source_commit", "source_tree"):
        if not re.fullmatch(r"[0-9a-f]{40}", firefox[key]):
            raise ReleaseError(f"Firefox must have an exact {key} pin")
    if firefox["remote"] != OFFICIAL_REMOTE:
        raise ReleaseError("Firefox source must come from the official Mozilla repository")
    if firefox["source_commit"] == firefox["commit"]:
        raise ReleaseError("Use the compact source commit, not native Mozilla ancestry")
    validate_engine_versions(repository, version)
    product = (repository / PRODUCT_VERSION).read_text(encoding="utf-8").strip()
    if product_parts(product)[:2] != esr_parts(version)[:2]:
        raise ReleaseError(
            "BashKitten version must match the Firefox major and minor version"
        )
    return {
        "bashkitten": product,
        "firefox": version,
        "ref": firefox["ref"],
        "commit": firefox["commit"],
        "source_commit": firefox["source_commit"],
        "source_tree": firefox["source_tree"],
    }


def validate_history(repository):
    firefox = pins(repository)
    if git(repository, "rev-parse", "--is-shallow-repository") == "true":
        raise ReleaseError(
            "Use the complete compact product history for Firefox updates"
        )
    if (
        git(repository, "rev-parse", f"{SOURCE_TAG_PREFIX}{firefox['ref']}^{{commit}}")
        != firefox["source_commit"]
    ):
        raise ReleaseError("Compact Firefox source tag does not match its pinned commit")
    if (
        git(repository, "rev-parse", f"{firefox['source_commit']}^{{tree}}")
        != firefox["source_tree"]
    ):
        raise ReleaseError("Compact Firefox source tree does not match its pin")
    git(repository, "merge-base", "--is-ancestor", firefox["source_commit"], "HEAD")


def official_release(repository, version):
    tag = release_tag(version)
    refs = dict(
        line.split()[::-1]
        for line in git(repository, "ls-remote", "--tags", OFFICIAL_REMOTE,
                        f"refs/tags/{tag}", f"refs/tags/{tag}^{{}}").splitlines()
    )
    commit = refs.get(f"refs/tags/{tag}^{{}}", refs.get(f"refs/tags/{tag}"))
    if not commit or not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ReleaseError(f"Official Firefox release not found: {tag}")
    return tag, commit


def snapshot_tree(repository, tag, commit):
    """Copy only pristine trees/blobs; native commits never enter product history."""
    common = pathlib.Path(
        git(repository, "rev-parse", "--path-format=absolute", "--git-common-dir")
    )
    objects = str(common / "objects")
    previous_tree = pins(repository)["source_tree"]
    with tempfile.TemporaryDirectory(prefix="firefox-source-", dir=common) as temporary:
        source = pathlib.Path(temporary)
        git(source, "init", "--bare", "--quiet")
        (source / "objects/info/alternates").write_text(objects + "\n", encoding="utf-8")
        # This isolated depth-one fetch is discarded, including its native commit
        # and shallow metadata. Never fetch Mozilla refs into the product repo.
        git(source, "fetch", "--depth=1", "--no-tags", "--no-recurse-submodules",
            "--no-auto-maintenance", OFFICIAL_REMOTE, f"refs/tags/{tag}")
        if git(source, "rev-parse", "FETCH_HEAD^{commit}") != commit:
            raise ReleaseError("Official Firefox tag changed while downloading its snapshot")
        tree = git(source, "rev-parse", "FETCH_HEAD^{tree}")
        # Seed with trees, never commits: modes, symlinks and all file bytes stay
        # exact, with no archive extraction or attribute/filter transformations.
        with (source / "snapshot.pack").open("w+b") as pack:
            result = subprocess.run(
                ["git", "-C", str(source), "pack-objects",
                 "--stdout", "--revs", "--quiet"],
                input=f"{tree}\n^{previous_tree}\n".encode(),
                stdout=pack, stderr=subprocess.PIPE, check=False,
            )
            if result.returncode:
                raise ReleaseError(result.stderr.decode(errors="replace"))
            pack.seek(0)
            result = subprocess.run(
                ["git", f"--git-dir={common}", "index-pack", "--stdin", "--strict"],
                stdin=pack, capture_output=True, text=True, check=False,
            )
            if result.returncode:
                raise ReleaseError(result.stderr.strip())
        if git(repository, "rev-parse", f"{tree}^{{tree}}") != tree:
            raise ReleaseError("Imported Firefox tree does not match the official snapshot")
        return tree


def latest_release(repository):
    firefox = pins(repository)
    major = esr_parts(firefox["version"])[0]
    refs = git(
        repository,
        "ls-remote",
        "--tags",
        firefox["remote"],
        f"refs/tags/FIREFOX_{major}_*esr_RELEASE",
    )
    versions = []
    for line in refs.splitlines():
        match = re.fullmatch(
            r"[0-9a-f]{40}\s+refs/tags/FIREFOX_([0-9_]+)esr_RELEASE", line
        )
        if match:
            versions.append(esr_parts(match[1].replace("_", ".")))
    if not versions:
        raise ReleaseError(f"No Firefox ESR {major} release tags found")
    return esr_version(".".join(map(str, max(versions))))


def require_clean(repository):
    if git(repository, "status", "--porcelain"):
        raise ReleaseError(
            "Commit or stash working changes before preparing an upstream update"
        )
    merge_head = pathlib.Path(git(repository, "rev-parse", "--git-path", "MERGE_HEAD"))
    if not merge_head.is_absolute():
        merge_head = repository / merge_head
    if merge_head.exists():
        raise ReleaseError("Finish the existing merge first")


def subtree_prefix(repository):
    root = pathlib.Path(git(repository, "rev-parse", "--show-toplevel"))
    prefix = repository.relative_to(root).as_posix()
    if prefix != "browser":
        raise ReleaseError("Firefox updates must target the browser/ source subtree")
    return prefix


def validate_merge_scope(repository):
    prefix = subtree_prefix(repository) + "/"
    root = pathlib.Path(git(repository, "rev-parse", "--show-toplevel"))
    changed = git(root, "diff", "--cached", "--name-only", "--no-renames", "-z")
    if any(path and not path.startswith(prefix) for path in changed.split("\0")):
        raise ReleaseError(
            "The Firefox merge changes files outside browser/; inspect before continuing"
        )


def checked_release(repository, version):
    tag, commit = official_release(repository, version)
    source_commit = git(repository, "rev-parse", f"{SOURCE_TAG_PREFIX}{tag}^{{commit}}")
    tree = git(repository, "rev-parse", f"{source_commit}^{{tree}}")
    if (
        git(repository, "show", "-s", "--format=%P", source_commit)
        != pins(repository)["source_commit"]
    ):
        raise ReleaseError("Firefox snapshot must descend only from the previous compact source")
    message = git(repository, "show", "-s", "--format=%B", source_commit).splitlines()
    for line in (
        f"Upstream-Tag: {tag}", f"Upstream-Commit: {commit}", f"Upstream-Tree: {tree}"
    ):
        if line not in message:
            raise ReleaseError("Firefox snapshot provenance does not match its official release")
    for name, expected in (
        ("version.txt", esr_version(version).removesuffix("esr")),
        ("version_display.txt", esr_version(version)),
    ):
        if git(repository, "show", f"{source_commit}:browser/config/{name}") != expected:
            raise ReleaseError(
                f"{tag} does not contain the expected Firefox version files"
            )
    return {
        "ref": tag, "commit": commit, "source_commit": source_commit,
        "source_tree": tree, "version": esr_version(version),
    }


def write_pin(repository, release):
    path = repository / PIN_FILE
    source = path.read_text(encoding="utf-8")
    match = re.search(r"(?ms)^\[firefox\]\n.*?(?=^\[|\Z)", source)
    if not match:
        raise ReleaseError("Missing Firefox upstream section")
    section = match[0]
    for key, value in release.items():
        section, count = re.subn(
            rf'(?m)^{key} = "[^"]*"$', f'{key} = "{value}"', section
        )
        if count != 1:
            raise ReleaseError(f"Missing or duplicate Firefox pin: {key}")
    path.write_text(
        source[: match.start()] + section + source[match.end() :], encoding="utf-8"
    )


def finish_update(repository, version):
    release = checked_release(repository, version)
    if git(repository, "diff", "--name-only", "--diff-filter=U"):
        raise ReleaseError(
            "Resolve and stage all merge conflicts before finishing the update"
        )
    merge_head = pathlib.Path(git(repository, "rev-parse", "--git-path", "MERGE_HEAD"))
    if not merge_head.is_absolute():
        merge_head = repository / merge_head
    if not merge_head.exists() or merge_head.read_text().strip() != release["source_commit"]:
        raise ReleaseError("The pending merge is not the requested Firefox release")
    validate_merge_scope(repository)
    old = pins(repository)
    if esr_parts(version) <= esr_parts(old["version"]):
        raise ReleaseError(
            "The requested Firefox release must be newer than the current pin"
        )
    product_path = repository / PRODUCT_VERSION
    product = next_product_version(product_path.read_text().strip(), version)
    validate_engine_versions(repository, esr_version(version))
    write_pin(repository, release)
    product_path.write_text(product + "\n", encoding="utf-8")
    validate_versions(repository)
    git(repository, "add", PIN_FILE, PRODUCT_VERSION)
    print(f"Prepared BashKitten {product} on {release['ref']} ({release['commit']}).")
    print(f"Compact source: {release['source_commit']} (tree {release['source_tree']}).")
    print("Review the staged merge, validate the browser, then commit it.")


def update(repository, version):
    require_clean(repository)
    prefix = subtree_prefix(repository)
    validate_versions(repository)
    validate_history(repository)
    firefox = pins(repository)
    if esr_parts(version) <= esr_parts(firefox["version"]):
        raise ReleaseError(
            "The requested Firefox release must be newer than the current pin"
        )
    tag, commit = official_release(repository, version)
    source_ref = SOURCE_TAG_PREFIX + tag
    if not git(repository, "tag", "--list", source_ref.removeprefix("refs/tags/")):
        tree = snapshot_tree(repository, tag, commit)
        source_commit = git(
            repository, "commit-tree", tree, "-p", firefox["source_commit"], "-m",
            f"Firefox {esr_version(version)} source snapshot\n\n"
            f"Upstream: {OFFICIAL_REMOTE}\nUpstream-Tag: {tag}\n"
            f"Upstream-Commit: {commit}\nUpstream-Tree: {tree}\n",
        )
        git(repository, "update-ref", source_ref, source_commit, "0" * 40)
    release = checked_release(repository, version)
    try:
        git(
            repository, "merge", "--no-commit", "--no-ff", "--strategy=ort",
            f"-Xsubtree={prefix}", release["source_commit"],
        )
    except ReleaseError as error:
        raise ReleaseError(
            f"{error}\nResolve and stage the conflicts, then run: "
            f"python3 browser/bashkitten/scripts/firefox_release.py finish {version}"
        ) from error
    finish_update(repository, version)


def main():
    parser = argparse.ArgumentParser(
        description="Update the Firefox ESR base and BashKitten release version"
    )
    parser.add_argument(
        "--repository", type=pathlib.Path, default=ROOT,
        help="Gecko source directory (the browser/ subtree)",
    )
    commands = parser.add_subparsers(dest="command", required=True)
    check = commands.add_parser(
        "check",
        help="Validate versions, optionally check Mozilla for newer ESR releases",
    )
    check.add_argument("--latest", action="store_true")
    check.add_argument(
        "--versions-only",
        action="store_true",
        help="Check version consistency without Git history or network access",
    )
    for name in ("update", "finish"):
        command = commands.add_parser(name)
        command.add_argument(
            "version", help="Exact Firefox ESR version, e.g. 153.2 or 153.2.1"
        )
    commands.add_parser("bump", help="Increment the BashKitten-only release number")
    arguments = parser.parse_args()
    repository = arguments.repository.resolve()
    try:
        if arguments.command == "check":
            result = validate_versions(repository)
            if not arguments.versions_only:
                validate_history(repository)
            if arguments.latest:
                _, commit = official_release(repository, result["firefox"])
                if commit != result["commit"]:
                    raise ReleaseError("Pinned Firefox provenance differs from its official release tag")
                result["latestFirefox"] = latest_release(repository)
            print(json.dumps(result, indent=2))
            if arguments.latest and esr_parts(result["latestFirefox"]) > esr_parts(
                result["firefox"]
            ):
                raise ReleaseError(
                    f"Firefox security update available: {result['latestFirefox']}"
                )
        elif arguments.command == "update":
            update(repository, arguments.version)
        elif arguments.command == "finish":
            finish_update(repository, arguments.version)
        else:
            require_clean(repository)
            result = validate_versions(repository)
            version = next_product_version(result["bashkitten"], result["firefox"])
            (repository / PRODUCT_VERSION).write_text(version + "\n", encoding="utf-8")
            print(version)
    except (ReleaseError, OSError, KeyError, ValueError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
