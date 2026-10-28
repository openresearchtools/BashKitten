#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
# References boundary only: reuse the packaged Search owner's native PDF reader.
import json, sys
from pathlib import Path
package_root=Path(__file__).resolve().parent.parent
agent_root=package_root if (package_root/'build-platform.json').is_file() else package_root/'agent'
root=agent_root/'search'
try:
    runtime=json.loads((root/'runtime/manifest.json').read_text())
    supported=runtime.get('pythonVersions',[runtime['python']])
    if list(sys.version_info[:2]) not in supported:
        raise RuntimeError('The packaged PDF reader does not support this Python version')
    abi=f'python{sys.version_info.major}.{sys.version_info.minor}'
    sys.path[:0]=[str(root/'src'),str(root/'runtime'/abi/'site-packages'),str(root/'runtime/site-packages')]
    from bashkitten_search._upstream._rag.parsers import _pdf
    pages,_,total=_pdf(sys.argv[1],want_images=False,max_pages=int(sys.argv[2]) if len(sys.argv)>2 else None)
    content='\n\n'.join(p.text for p in pages)
    print(json.dumps({'content':content,'indexedPages':len(pages),'totalPages':total,'indexedChars':len(content),'totalChars':len(content) if len(pages)==total else None},ensure_ascii=False))
except Exception as error:
    print(json.dumps({'error':str(error)}));sys.exit(1)
