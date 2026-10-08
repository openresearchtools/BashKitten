#!/usr/bin/env python3
"""Curate agent-facing skills in package staging; retain source guides intact."""
import argparse
import json
from pathlib import Path
import re
import shutil


def replace(text, old, new):
    if text.count(old) != 1:
        raise ValueError(f'Skill curation needs review after source changed: {old[:100]!r}')
    return text.replace(old, new, 1)


def browser_guide(text, target):
    text = replace(text, f'name: browser-{target}', 'name: browser')
    text = re.sub(r'^description: .*$', 'description: Read and control ordinary browser tabs: pages, forms, screenshots, downloads and debugging. Start with browser capabilities and its browserGuide.', text, count=1, flags=re.M)
    if target == 'linux':
        changes = [
            ('# BashKitten desktop browser', '# Browser'),
            ('Use this skill for the **connected browser**, not for the computer running the\nagent. The browser may be remote. A Linux agent can be connected to Android;\nthat connection requires the Android skill instead.', 'Use this skill for the **connected browser**. Start with `capabilities`; if\nits `browserGuide` differs from this file, read that guide before acting.'),
            ('Check `platform` and `methods`. Continue here only for `platform:"linux"`.\nPi adds `browserGuide`, the absolute path to the matching skill on the Pi host.', 'Check `methods` and `browserGuide`, the absolute path to the connected\nbrowser’s guide on the Pi host.'),
            ('once; do not repeatedly load help. `help` is implemented by the Pi extension,\nnot by the native browser dispatcher. It has no topic parameter.', 'once; do not repeatedly load help. It has no topic parameter.'),
            ('Desktop `act` normally returns a diff; it does not return an Android-style tree.', '`act` normally returns a diff.'),
            ('Within that browser result, desktop page text', 'Within that browser result, page text'),
            ('There is no desktop `stop` method', 'There is no `stop` method'),
            ('Desktop renders the links as text in content blocks, not an Android-style\narray of link objects.', 'Links are rendered as text in content blocks.'),
            ('The default condition timeout on desktop is 2000 milliseconds.', 'The default condition timeout is 2000 milliseconds.'),
            ('Native desktop file paths', 'Native file paths'),
            ("Desktop does not expose Android's `downloads.list/get` through this dispatcher;\ndo not use `browser_downloads` unless capabilities actually advertises them.", 'Use `browser_downloads` only when capabilities advertises `downloads.list/get`.'),
            ("Check `capabilities` and this platform's spelling; do not substitute Android methods.", 'Check `capabilities` and the parameter spelling in its guide.'),
        ]
        heading = '### Local shell entry point for agents without Pi tools'
    else:
        changes = [
            ('# BashKitten Android browser', '# Browser'),
            ("Use this skill for the **connected Android browser**, including a browser\ncontrolled remotely by Pi running on Linux. The agent host's OS does not select\nthe skill. This is browser-page automation, not phone-wide Android UI control.", 'Use this skill for the **connected browser**. Start with `capabilities`; if\nits `browserGuide` differs from this file, read that guide before acting.\nThis is browser-page automation, not phone-wide UI control.'),
            ("Check `platform`, `methods`, authorization and foreground information. Use\nthis guide for `android` or the help mapper's `termux` alias, not for `linux`.\nPi adds `browserGuide`, an absolute skill path on the Pi host.", 'Check `methods`, authorization, foreground information and `browserGuide`,\nthe absolute path to the connected browser’s guide on the Pi host.'),
            ('request help. `help` is a Pi-extension operation, not an Android browser\nmethod, and has no topic parameter.', 'request help. It has no topic parameter.'),
            ('name, or a desktop `e4` value.', 'name, or an invented value.'),
            ('Every Android snapshot', 'Every snapshot'),
            ('Android `act` returns an acknowledgement such as `ok` and `url`; there is no\nautomatic desktop-style diff.', '`act` returns an acknowledgement such as `ok` and `url`; there is no\nautomatic diff.'),
            ('as `details.result`. Inside that result, Android `read` returns a string for\nMarkdown/text or an array for links. `snapshot` returns a tree, not desktop\ncontent blocks. `evaluate` returns `hasValue` and `value`, or a description when\nthe result cannot be returned as a JSON value. Do not apply Linux result parsing.', 'as `details.result`. Inside that result, `read` returns a string for\nMarkdown/text or an array for links. `snapshot` returns a tree. `evaluate`\nreturns `hasValue` and `value`, or a description when the result cannot be\nreturned as a JSON value.'),
            ('Android create has no desktop `background`, `private`', '`tabs.create` has no `background`, `private`'),
            ("Uses Android's normal foreground-activity rules.", 'Uses normal foreground-activity rules.'),
            ('Do not use `navigate.action` on Android.', 'Do not use `navigate.action`.'),
            ("These are Android's default node/byte limits.", 'These are the default node/byte limits.'),
            ('Android uses the DOM snapshot backend. There is no', 'There is no'),
            ('Android does not support desktop\n`read` formats', '`read` does not support formats'),
            ('The Android allowlist does **not** include `hover_at`, `drag`, `drag_at`,\n`dialog_accept` or `dialog_dismiss`. Do not send those desktop actions here.', 'Available actions do **not** include `hover_at`, `drag`, `drag_at`,\n`dialog_accept` or `dialog_dismiss`.'),
            ('The default Android\ncondition timeout', 'The default\ncondition timeout'),
            ('Android has no full-page, clip, size,', 'There are no full-page, clip, size,'),
            ('Android has no desktop `download {ref:...}` or `upload` method.', 'There is no `download {ref:...}` or `upload` method.'),
            ("Returns recent captured console entries. This is not desktop\n`list_console_messages`; desktop filters and network/debugger methods are not\npart of Android's command surface. Missing entries do not prove no event occurred.", 'Returns recent captured console entries. Missing entries do not prove no event occurred.'),
            ('Use only methods advertised by this connection. Android has no desktop tab\naliases', 'Use only methods advertised by this connection. There are no tab\naliases'),
        ]
        heading = '### Local Termux entry point for agents without Pi tools'
    for old, new in changes:
        text = replace(text, old, new)
    # Shell/transport adapters serve other coding agents, not a Pi tool caller.
    start = text.index(heading)
    finish = text.index('### Recovery and boundaries', start)
    return text[:start] + text[finish:]


def search_guide(text):
    changes = [
        ('name: web-search', 'name: websearch'),
        ('using bashkitten-search.', 'using websearch.'),
        ('### Use the shell helper, not a browser command', '### Send one search or URL request'),
        ("Run `bashkitten-search` through Pi's `bash` tool, or another coding agent's\nshell tool. Linux and Android/Termux use the same command and JSON contract.\nThe command runs on the agent's host, not necessarily the browser's device.", 'Use the `websearch` tool. It runs on the agent’s host, which may differ\nfrom the browser’s device.'),
        ('Send exactly one JSON object on standard input, then close standard input.', 'Send exactly one JSON object per tool call.'),
        ('Do not pass command-line arguments. In the current implementation, even\n`--help` is rejected. There is no search `method: "help"`, help topic, or\nseparately registered `bashkitten_search` Pi tool. This skill is the usage guide.', 'This skill is the complete usage guide; there is no `method` or help topic.'),
        ('Check the shell exit status and the returned `ok` field.', 'Check the tool error state and returned `ok` field.'),
        ('The command writes one JSON response to stdout. Converter diagnostics may appear\non stderr; they are not another response. Read the JSON rather than guessing\nsuccess from a log message.', 'The tool returns one JSON response. Read it rather than guessing success\nfrom a diagnostic message.'),
        ('A nonzero exit is also failure, even when the error\nmessage says no results were found.', 'A tool error is also failure, even when the message says no results were found.'),
        ('## Part 2 — One-command examples', '## Part 2 — One-call examples'),
        ('Run each `sh` block as one shell command. Each command submits one request.\nKeep the quoted `<<\'JSON\'` delimiter: it prevents shell expansion within the\nrequest. Still encode quotes and newlines as valid JSON. For programmatically\nconstructed input, use a JSON serializer instead of shell interpolation.', 'Each JSON block below is one complete `websearch` tool call.'),
        ("A shell\nrunner's own timeout is separate and can terminate the command sooner.", 'Cancellation can terminate the request sooner.'),
        ('This command does not save the', 'This call does not save the'),
        ('not input to\n`bashkitten-search`.', 'not input to\n`websearch`.'),
        ('Another coding agent should use its corresponding local-file reader. Do not\nresubmit', 'Do not resubmit'),
    ]
    for old, new in changes:
        text = replace(text, old, new)
    text, count = re.subn(r"```sh\nbashkitten-search <<'JSON'\n(.*?)\nJSON\n```", r'```json\n\1\n```', text, flags=re.S)
    if count != 15:
        raise ValueError('Review changed websearch examples before packaging')
    return text


def curate(root, target):
    package_file = root / 'package.json'
    package = json.loads(package_file.read_text())
    guides = {}
    for platform in ['linux', 'android']:
        source = root / f'skills/browser-{platform}/SKILL.md'
        destination = 'skills/browser/SKILL.md' if platform == target else f'browser-guides/{platform}.md'
        path = root / destination
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(browser_guide(source.read_text(), platform))
        guides[platform] = destination
        shutil.rmtree(source.parent)
    search = root / 'skills/web-search'
    destination = root / 'skills/websearch'
    destination.mkdir()
    (destination / 'SKILL.md').write_text(search_guide((search / 'SKILL.md').read_text()))
    shutil.rmtree(search)
    if target == 'linux':
        shutil.rmtree(root / 'skills/termux-display')
    package['pi']['skills'] = ['./skills/browser', './skills/websearch', './skills/subagents']
    if target == 'android':
        package['pi']['skills'].append('./skills/termux-display')
    package['bashkitten'] = {'browserGuides': guides}
    package_file.write_text(json.dumps(package, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('target', choices=['linux', 'termux'])
    args = parser.parse_args()
    curate(args.root, 'android' if args.target == 'termux' else 'linux')
