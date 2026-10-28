// SPDX-License-Identifier: AGPL-3.0-only
import { dialog, node, field, button } from './shared/common.js';
import { documentBinding, managedContentCount } from './citations.mjs';
// Draft-only dialog. The caller commits through the existing native operation.
export async function chooseDocumentSettings({ api, current, projectHint, documentType, signal }) {
  signal?.throwIfAborted();
  const d = dialog('Document settings'), lifetime = new AbortController();
  const binding = documentBinding(current), managed = managedContentCount(current);
  const project = node('select', { required: true, 'aria-label': 'Project library' });
  const search = node('input', { type: 'search', placeholder: 'Search citation styles' });
  const style = node('select', { required: true, 'aria-label': 'Citation style' });
  const locale = node('select', { required: true, 'aria-label': 'Citation language' });
  const note = node('select', {}, new Option('Footnotes', 'footnote'), new Option('Endnotes', 'endnote'));
  note.value = current.noteType || 'footnote';
  const acknowledgement = node('input', { type: 'checkbox' });
  const warning = node('div', { class: 'binding-warning', hidden: true }, node('p', {}, 'Changing the project library unlinks the existing citations and bibliography. Their current text and formatting will stay exactly as they are. They will no longer update from a library.'), node('label', {}, acknowledgement, ' Keep existing citations and bibliography as formatted text. They will no longer update from References.'));
  const form = node('form', { class: 'document-settings' }, field('Project library', project), field('Find a citation style', search), field('Citation style', style), field('Language', locale));
  if (documentType === 'text') form.append(field('Note style placement', note));
  form.append(warning); d.body.append(form);
  let accepted = null, styleAbort, generation = 0, timer, loading = true, libraryLoading = false;
  const save = button('Save settings', () => form.requestSubmit(), { class: 'primary', disabled: true });
  d.actions.append(button('Cancel', () => d.el.close()), save);
  const switching = () => !!managed && project.value !== current.libraryId;
  function availability() { warning.hidden = !switching(); save.disabled = loading || libraryLoading || !project.value || !style.value || !locale.value || switching() && !acknowledgement.checked; }
  function error(error) { if (error.name !== 'AbortError') d.notice.textContent = error.message; }
  async function styles() {
    styleAbort?.abort(); const controller = styleAbort = new AbortController(), version = generation;
    const abort = () => controller.abort(); lifetime.signal.addEventListener('abort', abort, { once: true });
    loading = true; availability();
    try {
      const selected = style.value || binding?.style.id || current.style?.id || 'apa';
      const result = await api.project(project.value).request('styles?query=' + encodeURIComponent(search.value) + '&limit=80', { signal: controller.signal });
      if (version !== generation || controller.signal.aborted) return;
      style.replaceChildren();
      if (!result.items.some(item => item.id === selected)) style.append(new Option(selected, selected));
      for (const item of result.items) style.append(new Option(item.title, item.id));
      style.value = selected; loading = false; d.notice.textContent = ''; availability();
    } catch (e) { error(e); } finally { lifetime.signal.removeEventListener('abort', abort); }
  }
  async function library() {
    ++generation; acknowledgement.checked = false; loading = true; libraryLoading = true; availability();
    const version = generation;
    try {
      const [options] = await Promise.all([api.project(project.value).request('citation-options', { signal: lifetime.signal }), styles()]);
      if (version !== generation || lifetime.signal.aborted) return;
      const selected = locale.value || binding?.style.locale || current.style?.locale || 'en-US';
      locale.replaceChildren(...options.locales.map(value => new Option(value, value)));
      locale.value = selected; if (!locale.value) locale.value = 'en-US'; libraryLoading = false; availability();
    } catch (e) { error(e); }
  }
  project.addEventListener('change', library);
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(styles, 180); });
  for (const control of [acknowledgement, style, locale]) control.addEventListener('change', availability);
  form.addEventListener('submit', event => {
    event.preventDefault(); if (save.disabled) return;
    accepted = { operation: 'citations.bind', projectId: project.value, style: { id: style.value, locale: locale.value }, expectedRevision: current.revision, expectedNativeSnapshot: current.nativeSnapshot, ...(documentType === 'text' ? { noteType: note.value } : {}), ...(switching() ? { convertExistingToText: true } : {}) };
    d.el.close();
  });
  const abort = () => d.el.close(); signal?.addEventListener('abort', abort, { once: true });
  const closed = new Promise(resolve => d.el.addEventListener('close', () => { lifetime.abort(); styleAbort?.abort(); clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(accepted); }, { once: true }));
  d.open();
  try {
    const response = await api.request('/api/references/projects', { signal: lifetime.signal });
    if (lifetime.signal.aborted) return closed;
    const projects = Array.isArray(response) ? response : response.projects;
    project.append(new Option('Choose a project library', ''));
    for (const item of projects) if (!item.archived) project.append(new Option(item.name, item.id));
    project.value = binding?.projectId || current.libraryId || projectHint || '';
    if (project.value) await library(); else { loading = false; availability(); }
    project.focus();
  } catch (e) { error(e); }
  return closed;
}
