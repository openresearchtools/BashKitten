/* SPDX-License-Identifier: AGPL-3.0-only */
/** About's native owner reads only this device's saved downloads. */
export async function renderSection({ root, call, signal }) {
  const doc = root.ownerDocument;
  const node = (tag, text = '') => { const element = doc.createElementNS('http://www.w3.org/1999/xhtml', tag); element.textContent = text; return element; };
  const active = () => !signal.aborted && root.isConnected;
  const sourceURL = value => {
    try { const url = new URL(value); if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return url.href; } catch {}
    return 'Not recorded in the saved source information';
  };
  // Android's native runtime reader owns one complete, revision-pinned read.
  let reads = Promise.resolve();
  const read = action => {
    const next = reads.then(() => { if (!active()) throw Error('Licenses closed'); return action(); });
    reads = next.catch(() => {}); return next;
  };
  const field = (parent, title, value) => { if (value) parent.append(node('p', title + ': ' + value)); };
  const entry = (parent, title, load) => {
    const detail = node('details'), content = node('div');
    detail.append(node('summary', title), content); parent.append(detail);
    let loaded = false;
    detail.addEventListener('toggle', async () => {
      if (!detail.open || loaded || !active()) return;
      loaded = true; content.textContent = 'Loading saved notices…';
      try { await load(content); }
      catch (error) { if (active()) { content.textContent = 'Notices unavailable: ' + error.message; loaded = false; } }
    }, { signal });
  };
  const documents = (parent, choices, load) => {
    const label = node('label', 'Document'), select = node('select'), text = node('pre');
    for (const [id, title] of choices) { const option = node('option', title); option.value = id; select.append(option); }
    label.append(select); parent.append(label, text);
    const show = async () => {
      select.disabled = true; text.textContent = 'Loading saved notice…';
      try { const content = await read(() => load(select.value)); if (active()) text.textContent = content; }
      catch (error) { if (active()) text.textContent = 'Notice unavailable: ' + error.message; }
      finally { if (active()) select.disabled = false; }
    };
    select.addEventListener('change', show, { signal }); void show();
  };
  const modelDocument = async (id, file, noticeRevision) => {
    const chunks = []; let offset = 0, revision, total;
    do {
      if (!active()) throw Error('Licenses closed');
      const value = await call('native-models-catalogue', { notice: id, file, noticeRevision, offset, ...(revision ? { revision } : {}) });
      const bytes = Uint8Array.from(atob(value.data), char => char.charCodeAt(0));
      if (value.offset !== offset || !Number.isSafeInteger(value.total) || value.total < offset + bytes.length ||
          bytes.length > 48 * 1024 || !bytes.length && offset !== value.total || !/^[a-f0-9]{64}$/.test(value.revision) ||
          value.noticeRevision !== noticeRevision || revision && revision !== value.revision || total !== undefined && total !== value.total) throw Error('The saved model notice changed. Open it again.');
      chunks.push(bytes); offset += bytes.length; revision = value.revision; total = value.total;
    } while (offset < total);
    const bytes = new Uint8Array(total); offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  };
  root.append(node('p', 'Saved runtime and model licenses, source records and download origins on this device. Opening this page does not start services or download files.'));
  const runtimes = node('section'), models = node('section');
  runtimes.append(node('h2', 'AI runtimes')); models.append(node('h2', 'Models'));
  root.append(runtimes, models);
  await Promise.all([
    (async () => {
      try {
        const state = await call('localai-status'); if (!active()) return;
        let count = 0;
        for (const [engine, name] of [['llama', 'llama.cpp'], ['whisper', 'whisper.cpp']]) {
          const runtime = state[engine]?.runtime; if (!runtime) continue;
          count++;
          entry(runtimes, [name, runtime.upstreamVersion || runtime.version].filter(Boolean).join(' · '), async content => {
            const record = await read(() => call('localai-open-record', { engine, record: 'license' })); if (!active()) return;
            const attribution = record.attribution; content.replaceChildren();
            content.previousElementSibling.textContent = [attribution.name, attribution.version].filter(Boolean).join(' · ');
            field(content, 'Original project', [attribution.name, attribution.version].filter(Boolean).join(' · '));
            field(content, 'Original source', sourceURL(attribution.repository + '/tree/' + attribution.commit));
            field(content, 'Fetched from', sourceURL(attribution.download?.url));
            field(content, 'Published release', sourceURL(attribution.release));
            field(content, 'Downloaded archive SHA-256', attribution.download?.sha256);
            field(content, 'Build and packaging source', sourceURL(attribution.buildRepository + '/tree/' + attribution.buildCommit));
            documents(content, [['license', 'Full licenses and dependency notices'], ['source', 'Original source record']], async choice => {
              if (choice === 'license') return record.content;
              const source = await call('localai-open-record', { engine, record: 'source' });
              if (JSON.stringify(source.attribution) !== JSON.stringify(attribution)) throw Error('The installed runtime changed. Open its licenses again.');
              return source.content;
            });
          });
        }
        if (!count) runtimes.append(node('p', 'No downloaded AI runtimes are installed on this device.'));
      } catch (error) { if (active()) runtimes.append(node('p', 'Runtime notices unavailable: ' + error.message)); }
    })(),
    (async () => {
      try {
        const state = await call('native-models-catalogue'); if (!active()) return;
        for (const model of state.models || []) entry(models, [model.title, model.files?.join(', '), model.license].filter(Boolean).join(' · '), async content => {
          const files = await call('native-models-catalogue', { notice: model.id });
          const source = await read(() => modelDocument(model.id, 0, files.noticeRevision)); if (!active()) return;
          const attribution = JSON.parse(source); content.replaceChildren();
          field(content, 'Attribution', attribution.attribution);
          field(content, 'Fetched from', 'https://huggingface.co/' + attribution.repository + '/tree/' + attribution.revision);
          field(content, 'Revision', attribution.revision);
          field(content, 'License', attribution.license);
          for (const notice of attribution.provenanceNotes || []) content.append(node('p', notice));
          if (attribution.referenceVoice) field(content, 'Reference voice', attribution.referenceVoice.attribution);
          if (files.files.length === 1) content.append(node('p', 'No full license text was retained with this model. See its saved source record.'));
          documents(content, [...files.files.slice(1), files.files[0]].map(file => [String(file.index), file.name]), async index =>
            Number(index) === 0 ? source : modelDocument(model.id, Number(index), files.noticeRevision));
        });
        if (!state.models?.length) models.append(node('p', 'No saved model notices were found on this device. Models downloaded before notice retention, or imported separately, may not include saved licenses.'));
        for (const error of state.errors || []) models.append(node('p', 'Saved model notice unavailable: ' + error));
      } catch (error) { if (active()) models.append(node('p', 'Model notices unavailable: ' + error.message)); }
    })(),
  ]);
}
