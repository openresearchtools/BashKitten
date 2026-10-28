// SPDX-License-Identifier: AGPL-3.0-only
// Replaceable JS-UNO adapter. Runs unchanged in the native extension and the Pi view.
// Native scriptinterop is used where reliable; UNO covers fields, formulas, tables and anchors.
export function nativeOperation(request) {
  const css = uno.idl.com.sun.star;
  // cp-26.04.5-2's XFactory binding throws findOverloads on this build.
  // The released Desktop UNO service returns the same current native session view.
  const model = css.frame.Desktop.create(uno.componentContext).getCurrentComponent();
  const documentType = model.supportsService('com.sun.star.text.TextDocument') ? 'text'
    : model.supportsService('com.sun.star.sheet.SpreadsheetDocument') ? 'spreadsheet'
    : model.supportsService('com.sun.star.presentation.PresentationDocument') ? 'presentation' : 'unsupported';
  const propertyName = 'BashKittenReferencesV1';
  const properties = model.getDocumentProperties().getUserDefinedProperties();
  const short = value => new uno.Any(uno.type.short, value);
  const fail = message => { throw new Error(message); };
  const integer = (value, min, max, name) => Number.isInteger(value) && value >= min && value <= max ? value : fail('Invalid ' + name);
  const text = (value, max = 262144) => typeof value === 'string' && value.length <= max ? value : fail('Invalid or oversized text');
  const has = name => properties.getPropertySetInfo().hasPropertyByName(name);
  const portablePrefix = 'ADDIN BASHKITTEN_CITATION ';
  let fieldCache, applyingState;
  function portableFields() {
    if (fieldCache) return fieldCache;
    fieldCache = [];
    if (documentType !== 'text') return fieldCache;
    const fields = model.getTextFields().createEnumeration();
    while (fields.hasMoreElements()) {
      const field = fields.nextElement();
      if (typeof field.getParameters !== 'function') continue;
      const params = field.getParameters(), key = 'vnd.oasis.opendocument.field.code';
      if (!params.hasByName(key)) continue;
      const code = params.getByName(key);
      if (typeof code !== 'string' || !code.startsWith(portablePrefix) || code.length > 2 * 1024 * 1024) continue;
      try { const payload = JSON.parse(code.slice(portablePrefix.length)); if (payload.version === 1 && payload.citation?.id && (Array.isArray(payload.citation.items) || payload.bibliography === true)) fieldCache.push({ field, payload }); } catch (_) {}
    }
    return fieldCache;
  }
  const metadata = () => {
    const state = has(propertyName) ? JSON.parse(properties.getPropertyValue(propertyName)) : { version: 1, revision: 0, citations: [], bibliography: null };
    const seen = new Set();
    for (const { field, payload } of portableFields()) {
      const citation = { ...payload.citation }, original = citation.id;
      if (seen.has(original)) citation.id = original + ':copy:' + field.getName();
      seen.add(original);
      citation.anchor = { kind: 'field', name: field.getName(), note: citation.note || null };
      if (payload.bibliography) { state.bibliography = citation; continue; }
      const index = state.citations.findIndex(old => old.id === citation.id);
      if (index < 0) state.citations.push(citation); else state.citations[index] = citation;
      state.style ||= payload.style; state.libraryId ||= payload.libraryId;
      state.embeddedItems = { ...(state.embeddedItems || {}), ...(payload.embeddedItems || {}) };
    }
    return state;
  };
  function portablePayload(citation) {
    const state = applyingState || metadata(), embeddedItems = {};
    for (const item of citation.items || []) if (state.embeddedItems?.[item.id]) embeddedItems[item.id] = state.embeddedItems[item.id];
    const { anchor, target, runs, rendered, missing, ...occurrence } = citation;
    return portablePrefix + JSON.stringify({ version: 1, citation: occurrence, bibliography: citation.id === 'bibliography', style: state.style, libraryId: state.libraryId, embeddedItems });
  }
  function nativeMark(citation) {
    if (citation.anchor.kind === 'field') return portableFields().find(item => item.field.getName() === citation.anchor.name)?.field;
    const marks = model.getBookmarks(); return marks.hasByName(citation.anchor.name) ? marks.getByName(citation.anchor.name) : null;
  }
  const persist = state => {
    state.revision += 1;
    const value = JSON.stringify(state);
    if (value.length > 2 * 1024 * 1024) fail('Embedded citation metadata exceeds the document bound');
    const property = (name, value) => new css.beans.PropertyValue({ Name: name, Handle: 0, Value: value, State: css.beans.PropertyState.DIRECT_VALUE });
    const sequence = uno.type.sequence(uno.type.struct(css.beans.PropertyValue));
    const updated = [property('NamePrefix', propertyName), property('UserDefinedProperties', new uno.Any(sequence, [property(propertyName, value)]))];
    // Native SetDocumentProperties participates in the same undo context through
    // the isolated generic property-undo patch, and outlives this participant.
    css.frame.DispatchHelper.create(uno.componentContext).executeDispatch(model.getCurrentController().getFrame(), '.uno:SetDocumentProperties', '', 0, [property('UpdatedProperties', new uno.Any(sequence, updated))]);
    return state;
  };
  const checkRevision = state => {
    if (request.expectedRevision !== state.revision) fail('Citation state changed; read it again before applying this operation');
  };
  const requireType = type => { if (type !== documentType) fail('Operation requires ' + type); };
  function paragraph(index) {
    requireType('text'); integer(index, 0, 100000, 'paragraph index');
    const enumeration = model.getText().createEnumeration();
    let current = 0;
    while (enumeration.hasMoreElements()) {
      const element = enumeration.nextElement();
      if (element.supportsService('com.sun.star.text.Paragraph')) {
        if (current++ === index) return element;
      }
    }
    fail('Paragraph no longer exists');
  }
  function writerRange(target) {
    if (target?.selection) return model.getCurrentController().getViewCursor();
    const para = paragraph(target?.paragraph ?? 0);
    const value = para.getString();
    if (target.expectedText !== undefined && target.expectedText !== value) fail('Paragraph changed; refresh before editing');
    const offset = integer(target.offset ?? value.length, 0, value.length, 'text offset');
    const length = integer(target.length ?? 0, 0, value.length - offset, 'text length');
    const cursor = para.getText().createTextCursorByRange(para.getStart());
    cursor.goRight(offset, false); cursor.goRight(length, true);
    return cursor;
  }
  function sheet(name) {
    requireType('spreadsheet');
    const sheets = model.getSheets();
    if (typeof name === 'string') return sheets.getByName(name);
    return sheets.getByIndex(integer(name ?? 0, 0, sheets.getCount() - 1, 'sheet index'));
  }
  function cell(target) {
    if (target?.selection) return model.getCurrentController().getSelection();
    const result = sheet(target?.sheet).getCellRangeByName(text(target?.range ?? 'A1', 80));
    const address = result.getRangeAddress();
    if (address.StartColumn !== address.EndColumn || address.StartRow !== address.EndRow) fail('A managed citation occupies exactly one whole cell');
    return result.getCellByPosition(0, 0);
  }
  function slide(index) {
    requireType('presentation'); const pages = model.getDrawPages();
    return pages.getByIndex(integer(index ?? 0, 0, pages.getCount() - 1, 'slide index'));
  }
  function findShape(target) {
    const page = slide(target?.slide);
    if (target?.name) {
      for (let n = 0; n < page.getCount(); n++) { const shape = page.getByIndex(n); if (shape.getName() === target.name) return shape; }
      fail('Shape no longer exists');
    }
    return page.getByIndex(integer(target?.index ?? 0, 0, page.getCount() - 1, 'shape index'));
  }
  function anchorName(id) { return 'BKREF_' + text(id, 100).replace(/[^a-zA-Z0-9]/g, '').slice(0, 32); }
  function anchorFor(citation) {
    if (citation.anchor.kind === 'field') return nativeMark(citation)?.getAnchor() || null;
    if (citation.anchor.kind === 'bookmark') {
      const marks = model.getBookmarks();
      return marks.hasByName(citation.anchor.name) ? marks.getByName(citation.anchor.name).getAnchor() : null;
    }
    if (citation.anchor.kind === 'cell') {
      const names = model.getPropertyValue('NamedRanges');
      if (!names.hasByName(citation.anchor.name)) return null;
      return names.getByName(citation.anchor.name).getReferredCells();
    }
    if (citation.anchor.kind === 'shape') {
      const pages = model.getDrawPages();
      for (let p = 0; p < pages.getCount(); p++) for (let s = 0; s < pages.getByIndex(p).getCount(); s++) {
        const shape = pages.getByIndex(p).getByIndex(s);
        if (shape.getName() === citation.anchor.name) return shape;
      }
      return null;
    }
    return null;
  }
  function rendered(citation) { const anchor = anchorFor(citation); return anchor ? anchor.getString() : null; }
  function writerLocation(range) {
    let location = range;
    try { if (range.getText().supportsService('com.sun.star.text.Footnote')) location = range.getText().getAnchor(); } catch (_) {}
    const enumeration = model.getText().createEnumeration(); let index = 0;
    while (enumeration.hasMoreElements()) {
      const para = enumeration.nextElement();
      if (!para.supportsService('com.sun.star.text.Paragraph')) continue;
      try {
        const owner = para.getText();
        if (owner.compareRegionStarts(para.getStart(), location.getStart()) >= 0 && owner.compareRegionStarts(para.getEnd(), location.getStart()) <= 0) {
          const cursor = owner.createTextCursorByRange(para.getStart()); cursor.gotoRange(location.getStart(), true);
          return { paragraph: index, offset: cursor.getString().length, length: location.getString().length, expectedText: para.getString() };
        }
      } catch (_) {}
      index++;
    }
    fail('The native text location is outside the main document');
  }
  function selectionTarget() {
    const controller = model.getCurrentController();
    if (documentType === 'text') return writerLocation(controller.getViewCursor());
    if (documentType === 'spreadsheet') {
      const selected = controller.getSelection(), address = selected.getRangeAddress();
      if (address.StartColumn !== address.EndColumn || address.StartRow !== address.EndRow) fail('Select a single cell for the citation');
      return { sheet: model.getSheets().getByIndex(address.Sheet).getName(), range: selected.getPropertyValue('AbsoluteName').split('.').slice(-1)[0], expectedText: selected.getString() };
    }
    const pages = model.getDrawPages(), current = controller.getCurrentPage();
    for (let n = 0; n < pages.getCount(); n++) if (pages.getByIndex(n).getName() === current.getName()) return { slide: n };
    fail('No current slide');
  }
  function orderPosition(citation) {
    const anchor = citation.anchor && anchorFor(citation);
    if (documentType === 'text') {
      const location = anchor ? writerLocation(anchor) : citation.target;
      return [location.paragraph, location.offset];
    }
    if (documentType === 'spreadsheet') {
      const address = (anchor || cell(citation.target)).getRangeAddress(); return [address.Sheet, address.StartRow, address.StartColumn];
    }
    if (anchor) {
      const pages = model.getDrawPages();
      for (let p = 0; p < pages.getCount(); p++) for (let n = 0; n < pages.getByIndex(p).getCount(); n++) if (pages.getByIndex(p).getByIndex(n).getName() === anchor.getName()) return [p, n];
    }
    return [citation.target?.slide ?? 0, Number.MAX_SAFE_INTEGER];
  }
  function orderCitations(citations) {
    const order = new Map(citations.map(c => [c.id, orderPosition(c)]));
    return citations.sort((a, b) => { const x = order.get(a.id), y = order.get(b.id); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; });
  }
  function snapshot(state) {
    return JSON.stringify([...state.citations, ...(state.bibliography?.anchor ? [state.bibliography] : [])].map(c => ({ id: c.id, rendered: rendered(c), position: anchorFor(c) ? orderPosition(c) : null })));
  }
  function inspectCitations() {
    const state = metadata();
    state.citations = state.citations.map(c => ({ ...c, rendered: rendered(c), missing: !anchorFor(c) }));
    if (state.bibliography?.anchor) state.bibliography = { ...state.bibliography, rendered: rendered(state.bibliography), missing: !anchorFor(state.bibliography) };
    const live = state.citations.filter(c => !c.missing);
    state.citations = [...orderCitations(live), ...state.citations.filter(c => c.missing)];
    state.nativeSnapshot = snapshot(state);
    return state;
  }
  function intersectsManaged(range) {
    const state = metadata();
    for (const citation of [...state.citations, ...(state.bibliography?.anchor ? [state.bibliography] : [])]) {
      const anchor = anchorFor(citation); if (!anchor) continue;
      if (documentType === 'text') {
        try {
          const owner = range.getText();
          // compareRegionStarts returns +1 when its first argument precedes the second.
          const beginsBeforeEnd = owner.compareRegionStarts(range.getStart(), anchor.getEnd()) > 0;
          const endsAfterStart = owner.compareRegionStarts(range.getEnd(), anchor.getStart()) < 0;
          if (beginsBeforeEnd && endsAfterStart) return true;
        } catch (error) { if (!String(error.message).includes('IllegalArgument')) throw error; }
      } else if (documentType === 'spreadsheet') {
        const a = anchor.getRangeAddress(), b = range.getRangeAddress();
        if (a.Sheet === b.Sheet && a.StartColumn <= b.EndColumn && a.EndColumn >= b.StartColumn && a.StartRow <= b.EndRow && a.EndRow >= b.StartRow) return true;
      } else if (anchor.getName() === range.getName()) return true;
    }
    return false;
  }
  function applyRuns(range, runs) {
    const owner = range.getText ? range.getText() : range;
    const cursor = owner.createTextCursorByRange(range.getStart());
    const full = range.getString();
    cursor.gotoRange(range.getEnd(), true);
    cursor.setPropertyValue('CharPosture', css.awt.FontSlant.NONE);
    cursor.setPropertyValue('CharWeight', new uno.Any(uno.type.float, 100));
    cursor.setPropertyValue('CharEscapement', short(0));
    cursor.setPropertyValue('CharUnderline', short(0));
    const supportsLink = cursor.getPropertySetInfo().hasPropertyByName('HyperLinkURL');
    if (supportsLink) cursor.setPropertyValue('HyperLinkURL', '');
    let offset = 0;
    for (const run of runs ?? []) {
      if (!run.text || offset + run.text.length > full.length) continue;
      cursor.gotoRange(range.getStart(), false); cursor.goRight(offset, false); cursor.goRight(run.text.length, true);
      if (run.italic) cursor.setPropertyValue('CharPosture', css.awt.FontSlant.ITALIC);
      if (run.bold) cursor.setPropertyValue('CharWeight', new uno.Any(uno.type.float, 150));
      if (run.superscript) { cursor.setPropertyValue('CharEscapement', short(33)); cursor.setPropertyValue('CharEscapementHeight', new uno.Any(uno.type.byte, 58)); }
      if (run.subscript) { cursor.setPropertyValue('CharEscapement', short(-33)); cursor.setPropertyValue('CharEscapementHeight', new uno.Any(uno.type.byte, 58)); }
      if (run.underline) cursor.setPropertyValue('CharUnderline', short(1));
      if (run.url && supportsLink) cursor.setPropertyValue('HyperLinkURL', run.url);
      offset += run.text.length;
    }
  }
  function writeAnchor(citation, target, replace) {
    let anchor = replace ? anchorFor(citation) : null;
    if (replace && !anchor) fail('Citation anchor was deleted; refresh the document state');
    if (documentType === 'text') {
      let insertionRange;
      if (anchor && (citation.anchor.note || null) !== (citation.note || null)) {
        const oldNote = citation.anchor.note ? anchor.getText() : null;
        const oldRange = oldNote ? oldNote.getAnchor() : anchor;
        insertionRange = oldRange.getText().createTextCursorByRange(oldRange.getStart());
        if (!oldNote) insertionRange.gotoRange(oldRange.getEnd(), true);
        nativeMark(citation).dispose(); fieldCache = null;
        if (oldNote) oldRange.getText().removeTextContent(oldNote); else insertionRange.setString('');
        anchor = null;
      }
      if (!anchor) {
        let range = insertionRange || writerRange(target || {});
        if (intersectsManaged(range)) fail('The insertion target overlaps a managed citation');
        if (citation.note) {
          const footnote = model.createInstance(citation.note === 'endnote' ? 'com.sun.star.text.Endnote' : 'com.sun.star.text.Footnote');
          range.getText().insertTextContent(range, footnote, false);
          range = footnote.createTextCursor();
        }
        const mark = model.createInstance('com.sun.star.text.Fieldmark'); mark.setPropertyValue('PrivateSeparatorAtStart', true); mark.setName(anchorName(citation.id));
        range.setString(citation.text); range.getText().insertTextContent(range, mark, true);
        mark.setFieldType('vnd.oasis.opendocument.field.UNHANDLED'); mark.getParameters().insertByName('vnd.oasis.opendocument.field.code', portablePayload(citation)); fieldCache = null;
        citation.anchor = { kind: 'field', name: mark.getName(), note: citation.note || null };
        anchor = mark.getAnchor();
      } else {
        // Reattach the native bookmark around the replacement; no paragraph flattening.
        const oldMark = nativeMark(citation);
        const range = anchor.getText().createTextCursorByRange(anchor.getStart()); range.gotoRange(anchor.getEnd(), true);
        oldMark.dispose(); range.setString(citation.text);
        const mark = model.createInstance('com.sun.star.text.Fieldmark'); mark.setPropertyValue('PrivateSeparatorAtStart', true); mark.setName(citation.anchor.name);
        range.getText().insertTextContent(range, mark, true); mark.setFieldType('vnd.oasis.opendocument.field.UNHANDLED'); mark.getParameters().insertByName('vnd.oasis.opendocument.field.code', portablePayload(citation)); fieldCache = null;
        citation.anchor = { kind: 'field', name: mark.getName(), note: citation.note || null }; anchor = mark.getAnchor();
      }
      applyRuns(anchor, citation.runs);
    } else if (documentType === 'spreadsheet') {
      if (!anchor) {
        anchor = cell(target);
        if (intersectsManaged(anchor)) fail('This cell already contains a managed citation');
        if (target?.expectedText !== undefined && anchor.getString() !== target.expectedText) fail('Cell changed; refresh before insertion');
        const address = anchor.getCellAddress();
        const names = model.getPropertyValue('NamedRanges'); const name = anchorName(citation.id);
        names.addNewByName(name, anchor.getPropertyValue('AbsoluteName'), address, 0);
        citation.anchor = { kind: 'cell', name };
      }
      anchor.setString(citation.text); applyRuns(anchor, citation.runs);
    } else if (documentType === 'presentation') {
      if (!anchor) {
        const page = slide(target?.slide);
        if (target?.existingShape) {
          anchor = findShape(target);
          if (intersectsManaged(anchor) || anchor.getString() !== target.expectedText) fail('The citation code shape changed');
        } else { anchor = model.createInstance('com.sun.star.drawing.TextShape'); page.add(anchor); }
        anchor.setName(anchorName(citation.id));
        if (!target?.existingShape) anchor.setPosition(new css.awt.Point({ X: integer(target?.x ?? 1000, 0, 200000, 'x'), Y: integer(target?.y ?? 1000, 0, 200000, 'y') }));
        if (!target?.existingShape) anchor.setSize(new css.awt.Size({ Width: integer(target?.width ?? 18000, 100, 200000, 'width'), Height: integer(target?.height ?? 2000, 100, 200000, 'height') }));
        citation.anchor = { kind: 'shape', name: anchor.getName() };
      }
      anchor.setString(citation.text); applyRuns(anchor, citation.runs);
    } else fail('Unsupported document family');
    return citation;
  }
  function removeAnchor(citation, unlink) {
    const anchor = anchorFor(citation); if (!anchor) return;
    if (documentType === 'text') {
      const mark = nativeMark(citation);
      const note = citation.anchor.note && !unlink ? anchor.getText() : null;
      if (!unlink && !note) anchor.setString(''); mark.dispose(); fieldCache = null;
      if (note) note.getAnchor().getText().removeTextContent(note);
    } else if (documentType === 'spreadsheet') {
      if (!unlink) anchor.setString(''); model.getPropertyValue('NamedRanges').removeByName(citation.anchor.name);
    } else if (!unlink) {
      const pages = model.getDrawPages();
      for (let p = 0; p < pages.getCount(); p++) { const page = pages.getByIndex(p); for (let s = 0; s < page.getCount(); s++) if (page.getByIndex(s).getName() === citation.anchor.name) { page.remove(anchor); return; } }
    } else anchor.setName('Text_' + citation.id);
  }
  const operation = request.operation;
  if (operation === 'capabilities') return { documentType, adapterVersion: 1, preferredModel: false, nativeUno: true, citations: true, boundedInspection: true };
  if (operation === 'selection') return { documentType, target: selectionTarget() };
  if (operation === 'codes.region') {
    if (documentType === 'text') {
      const target = request.target || selectionTarget(), para = paragraph(target.paragraph);
      const style = para.getPropertyValue('ParaStyleName');
      return { documentType, text: para.getString(), target: { paragraph: target.paragraph }, codeStyle: /(?:code|preformatted|source)/i.test(style) };
    }
    if (documentType === 'spreadsheet') {
      const target = request.target || selectionTarget(), value = cell(target);
      return { documentType, text: value.getString(), target, formula: value.getFormula().startsWith('=') };
    }
    let target = request.target;
    if (!target) {
      const selection = model.getCurrentController().getSelection();
      if (!selection || typeof selection.getCount !== 'function' || selection.getCount() !== 1) return { documentType, text: '', unavailable: 'Select one text shape' };
      const shape = selection.getByIndex(0); target = { ...selectionTarget(), name: shape.getName() };
    }
    const shape = findShape(target);
    return { documentType, text: shape.getString(), target: { ...target, existingShape: true } };
  }
  if (operation === 'citations.inspect') return inspectCitations();
  if (operation === 'citations.prepare') {
    const current = metadata(); checkRevision(current);
    const desired = request.state;
    for (const citation of desired.citations) {
      const old = current.citations.find(c => c.id === citation.id);
      if (old) { citation.anchor = old.anchor; if (!anchorFor(old)) fail('A citation anchor was deleted; reconcile it before refresh'); }
      else if (!citation.target || citation.target.selection) citation.target = selectionTarget();
    }
    desired.citations = orderCitations(desired.citations);
    let addedNotes = 0;
    for (let index = 0; index < desired.citations.length; index++) {
      const citation = desired.citations[index];
      if (documentType !== 'text') citation.noteIndex = index + 1;
      else {
        const location = citation.anchor ? anchorFor(citation) : writerRange(citation.target);
        const at = orderPosition(citation), notes = desired.noteType === 'endnote' ? model.getEndnotes() : model.getFootnotes(); let preceding = 0;
        for (let n = 0; n < notes.getCount(); n++) {
          const pos = writerLocation(notes.getByIndex(n).getAnchor());
          if (pos.paragraph < at[0] || pos.paragraph === at[0] && pos.offset < at[1]) preceding++;
        }
        citation.noteIndex = preceding + addedNotes + 1;
        if (!citation.anchor?.note) addedNotes++;
      }
    }
    desired.nativeSnapshot = snapshot(current);
    return desired;
  }
  if (operation === 'inspect') {
    const result = { documentType, citations: inspectCitations() };
    const offset = integer(request.offset ?? 0, 0, 100000, 'offset'), limit = integer(request.limit ?? 100, 1, 500, 'limit');
    if (documentType === 'text') {
      const enumeration = model.getText().createEnumeration(); result.paragraphs = []; let n = 0;
      while (enumeration.hasMoreElements() && result.paragraphs.length < limit + 1) {
        const element = enumeration.nextElement();
        if (element.supportsService('com.sun.star.text.Paragraph')) { if (n >= offset) result.paragraphs.push({ index: n, text: element.getString() }); n++; }
      }
      result.hasMore = result.paragraphs.length > limit; if (result.hasMore) result.paragraphs.pop();
      result.nextOffset = offset + result.paragraphs.length; result.tables = model.getTextTables().getElementNames();
    } else if (documentType === 'spreadsheet') {
      result.sheets = model.getSheets().getElementNames();
      const range = sheet(request.sheet).getCellRangeByName(text(request.range ?? 'A1:T50', 80));
      const address = range.getRangeAddress();
      if ((address.EndColumn - address.StartColumn + 1) * (address.EndRow - address.StartRow + 1) > 10000) fail('Inspect at most 10,000 cells per request');
      result.range = address; result.values = range.getDataArray(); result.formulas = range.getFormulaArray();
    } else if (documentType === 'presentation') {
      result.slides = []; const pages = model.getDrawPages();
      for (let p = offset; p < Math.min(pages.getCount(), offset + limit); p++) {
        const page = pages.getByIndex(p), shapes = [];
        for (let s = 0; s < Math.min(page.getCount(), 500); s++) { const shape = page.getByIndex(s); shapes.push({ index: s, name: shape.getName(), type: shape.getShapeType(), text: typeof shape.getString === 'function' ? shape.getString() : null, position: shape.getPosition(), size: shape.getSize() }); }
        result.slides.push({ index: p, name: page.getName(), shapes, shapesTruncated: page.getCount() > 500 });
      }
      result.hasMore = offset + result.slides.length < pages.getCount(); result.nextOffset = offset + result.slides.length;
    }
    return result;
  }
  const undo = model.getUndoManager(), undoTitle = 'References / Pi: ' + operation + ' ' + Date.now();
  const previousMetadata = has(propertyName) ? properties.getPropertyValue(propertyName) : null;
  let failed = false;
  undo.enterUndoContext(undoTitle);
  try {
    if (operation === 'native.uno') {
      if (typeof request.command !== 'string' || !/^\.uno:[A-Za-z0-9_]+$/.test(request.command)) fail('A native .uno command is required');
      const types = { string: uno.type.string, boolean: uno.type.boolean, short: uno.type.short, long: uno.type.long, float: uno.type.float, double: uno.type.double };
      const args = (request.arguments || []).map(argument => {
        if (!types[argument.type]) fail('Unsupported UNO value type; use native.script for structured native values');
        return new css.beans.PropertyValue({ Name: text(argument.name, 100), Handle: 0, Value: new uno.Any(types[argument.type], argument.value), State: css.beans.PropertyState.DIRECT_VALUE });
      });
      const result = css.frame.DispatchHelper.create(uno.componentContext).executeDispatch(model.getCurrentController().getFrame(), request.command, '', 0, args);
      return { dispatched: request.command, result };
    }
    if (operation === 'text.edit') {
      requireType('text'); const range = writerRange(request.target);
      if (intersectsManaged(range)) fail('Prose edit overlaps a managed citation; use citation operations to edit it');
      range.setString(text(request.text)); return { edited: true };
    }
    if (operation === 'text.append') {
      requireType('text'); const body = model.getText(), cursor = body.createTextCursor(); cursor.gotoEnd(false);
      const lines = text(request.text).split('\n');
      for (let i = 0; i < lines.length; i++) { if (i) body.insertControlCharacter(cursor, css.text.ControlCharacter.PARAGRAPH_BREAK, false); body.insertString(cursor, lines[i], false); cursor.gotoEnd(false); }
      return { edited: true };
    }
    if (operation === 'table.insert') {
      requireType('text'); const table = model.createInstance('com.sun.star.text.TextTable');
      table.initialize(integer(request.rows, 1, 200, 'rows'), integer(request.columns, 1, 100, 'columns'));
      const range = writerRange(request.target || {}); if (intersectsManaged(range)) fail('Table target overlaps a citation');
      range.getText().insertTextContent(range, table, false);
      if (request.name) table.setName(text(request.name, 80)); return { name: table.getName() };
    }
    if (operation === 'table.set') {
      requireType('text'); const table = model.getTextTables().getByName(text(request.table, 80));
      if (!Array.isArray(request.cells) || request.cells.length > 10000) fail('Bounded cell edits required');
      const changes = request.cells.map(edit => {
        const cell = table.getCellByName(text(edit.cell, 20)), value = text(edit.text);
        const range = cell.createTextCursor(); range.gotoEnd(true);
        if (intersectsManaged(range)) fail('Table cell contains a managed citation; edit the native text range instead');
        if (edit.expectedText !== undefined && cell.getString() !== edit.expectedText) fail('Table cell changed');
        return { cell, value };
      });
      for (const change of changes) change.cell.setString(change.value); return { edited: changes.length };
    }
    if (operation === 'sheet.set') {
      const range = sheet(request.sheet).getCellRangeByName(text(request.range, 80));
      const a = range.getRangeAddress(), count = (a.EndColumn - a.StartColumn + 1) * (a.EndRow - a.StartRow + 1);
      if (count > 10000 || intersectsManaged(range)) fail('Range is too large or overlaps managed citations');
      if (request.expectedFormulas && JSON.stringify(range.getFormulaArray()) !== JSON.stringify(request.expectedFormulas)) fail('Cells changed; inspect before editing');
      if (request.formulas) range.setFormulaArray(request.formulas); else range.setDataArray(request.values);
      return { edited: count };
    }
    if (operation === 'sheet.insert') { requireType('spreadsheet'); model.getSheets().insertNewByName(text(request.name, 80), integer(request.index ?? model.getSheets().getCount(), 0, model.getSheets().getCount(), 'sheet index')); return { inserted: true }; }
    if (operation === 'sheet.rows' || operation === 'sheet.columns') {
      const owner = sheet(request.sheet), collection = operation === 'sheet.rows' ? owner.getRows() : owner.getColumns();
      const index = integer(request.index, 0, collection.getCount() - 1, 'index'), count = integer(request.count, 1, 1000, 'count');
      if (request.action === 'insert') collection.insertByIndex(index, count); else if (request.action === 'remove') collection.removeByIndex(index, count); else fail('Invalid structural action');
      return { edited: true };
    }
    if (operation === 'slide.insert') { requireType('presentation'); const pages = model.getDrawPages(); const page = pages.insertNewByIndex(integer(request.index ?? pages.getCount(), 0, pages.getCount(), 'slide index')); if (request.name) page.setName(text(request.name, 80)); return { inserted: true }; }
    if (operation === 'slide.remove') { model.getDrawPages().remove(slide(request.slide)); return { removed: true }; }
    if (operation === 'shape.insert') {
      const page = slide(request.slide), shape = model.createInstance('com.sun.star.drawing.TextShape'); page.add(shape);
      if (request.name) shape.setName(text(request.name, 80));
      shape.setPosition(new css.awt.Point({ X: integer(request.x ?? 1000, 0, 200000, 'x'), Y: integer(request.y ?? 1000, 0, 200000, 'y') }));
      shape.setSize(new css.awt.Size({ Width: integer(request.width ?? 18000, 100, 200000, 'width'), Height: integer(request.height ?? 2000, 100, 200000, 'height') }));
      shape.setString(text(request.text)); return { name: shape.getName() };
    }
    if (operation === 'shape.edit') {
      const shape = findShape(request.target); if (intersectsManaged(shape)) fail('Shape contains a managed citation');
      if (request.expectedText !== undefined && shape.getString() !== request.expectedText) fail('Shape text changed');
      if (request.text !== undefined) shape.setString(text(request.text));
      if (request.position) shape.setPosition(new css.awt.Point({ X: request.position.x, Y: request.position.y }));
      if (request.size) shape.setSize(new css.awt.Size({ Width: request.size.width, Height: request.size.height }));
      return { edited: true };
    }
    if (operation === 'format') {
      const allowed = ['CharColor', 'CharHeight', 'CharFontName', 'CharWeight', 'CharPosture', 'CellBackColor', 'NumberFormat', 'ParaAdjust', 'ParaStyleName', 'FillColor', 'FillTransparence'];
      const target = documentType === 'text' ? writerRange(request.target) : documentType === 'spreadsheet' ? sheet(request.target.sheet).getCellRangeByName(request.target.range) : findShape(request.target);
      for (const [name, value] of Object.entries(request.properties || {})) { if (!allowed.includes(name)) fail('Unsupported property ' + name); target.setPropertyValue(name, value); }
      return { formatted: true };
    }
    if (operation === 'citations.apply') {
      const state = metadata(); checkRevision(state);
      if (!request.state || request.state.version !== 1 || !Array.isArray(request.state.citations) || request.state.citations.length > 10000) fail('Invalid citation state');
      const desired = request.state;
      applyingState = desired;
      if (desired.nativeSnapshot !== undefined && desired.nativeSnapshot !== snapshot(state)) fail('Native citation positions or text changed during rendering; refresh before applying');
      for (const c of desired.citations) { text(c.text); if (c.anchor && !anchorFor(c)) fail('Citation anchor missing'); }
      delete desired.nativeSnapshot;
      for (const old of state.citations) if (!desired.citations.some(c => c.id === old.id)) removeAnchor(old, false);
      const citations = [];
      for (const incoming of desired.citations) {
        const old = state.citations.find(c => c.id === incoming.id), citation = { ...incoming, anchor: old?.anchor };
        if (old && !anchorFor(old)) fail('Citation anchor was deleted; reconcile before refresh');
        citations.push(writeAnchor(citation, incoming.target, !!old)); delete citation.target; delete citation.runs;
      }
      let bibliography = null;
      if (desired.bibliography?.text !== undefined) {
        bibliography = { ...desired.bibliography, id: desired.bibliography.id || 'bibliography', anchor: state.bibliography?.anchor };
        writeAnchor(bibliography, desired.bibliography.target, !!state.bibliography?.anchor); delete bibliography.target; delete bibliography.runs;
      } else if (state.bibliography?.anchor) removeAnchor(state.bibliography, false);
      persist({ ...desired, revision: state.revision, citations, bibliography });
      return inspectCitations();
    }
    if (operation === 'citations.unlink') {
      const state = metadata(); checkRevision(state);
      for (const citation of [...state.citations, ...(state.bibliography?.anchor ? [state.bibliography] : [])]) removeAnchor(citation, true);
      if (has(propertyName)) properties.removeProperty(propertyName); return { unlinked: true };
    }
    fail('Unknown Office operation ' + operation);
  } catch (error) { failed = true; throw error; }
  finally {
    undo.leaveUndoContext();
    if (failed && undo.isUndoPossible() && undo.getCurrentUndoActionTitle() === undoTitle) {
      undo.undo();
      if (previousMetadata === null) { if (has(propertyName)) properties.removeProperty(propertyName); }
      else if (has(propertyName)) properties.setPropertyValue(propertyName, previousMetadata);
      else properties.addProperty(propertyName, 128, previousMetadata);
    }
  }
}
