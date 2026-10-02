#!/usr/bin/env python3
"""Build store submission ZIPs using only extension runtime files."""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / 'manifest.json').read_text())
version = manifest['version']
files = {'popup.html', 'popup.js', 'popup.css'}
for script in manifest['content_scripts']:
    files.update(script.get('js', []))
    files.update(script.get('css', []))
files.update(str(p.relative_to(root)) for p in (root / 'icons').glob('*.png'))
(root / 'dist').mkdir(exist_ok=True)
for browser, suffix in [('chrome', 'chrome-store'), ('firefox', 'firefox-amo')]:
    packaged_manifest = dict(manifest)
    if browser == 'chrome':
        packaged_manifest.pop('browser_specific_settings', None)
    destination = root / 'dist' / f'chatgpt-bulk-delete-{suffix}-{version}.zip'
    with ZipFile(destination, 'w', ZIP_DEFLATED) as archive:
        archive.writestr('manifest.json', json.dumps(packaged_manifest, indent=2) + '\n')
        for name in sorted(files):
            archive.write(root / name, name)
    # Preserve the existing stable submission filenames.
    (root / 'dist' / f'chatgpt-bulk-delete-{suffix}.zip').write_bytes(destination.read_bytes())
    print(destination)
