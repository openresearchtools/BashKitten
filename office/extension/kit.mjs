// SPDX-License-Identifier: AGPL-3.0-only
// Replaceable JS-UNO adapter. Runs unchanged in the native extension and the Pi view.
// Native scriptinterop is used where reliable; UNO covers fields, formulas, tables and anchors.
export function nativeOperation(request) {
  const css = uno.idl.com.sun.star;
  // cp-26.04.5-2's XFactory binding throws findOverloads on this build.
  // The released Desktop UNO service returns the same current native session view.
  const view = css.frame.Desktop.create(uno.componentContext).getCurrentFrame().getController();
  const model = view.getModel();
  const documentType = model.supportsService('com.sun.star.text.TextDocument') ? 'text'
    : model.supportsService('com.sun.star.sheet.SpreadsheetDocument') ? 'spreadsheet'
    : model.supportsService('com.sun.star.presentation.PresentationDocument') ? 'presentation' : 'unsupported';
  const propertyName = 'BashKittenReferencesV1';
  const properties = model.getDocumentProperties().getUserDefinedProperties();
  const short = value => new uno.Any(uno.type.short, value);
  const fail = message => { throw new Error(message); };
  const integer = (value, min, max, name) => Number.isInteger(value) && value >= min && value <= max ? value : fail('Invalid ' + name);
  const text = (value, max = 262144, field = 'text') => typeof value === 'string' && value.length <= max ? value : fail('Invalid or oversized ' + field);
  const has = name => properties.getPropertySetInfo().hasPropertyByName(name);
  const portablePrefix = 'ADDIN BASHKITTEN_CITATION ';
  const portableNamespace = 'urn:bashkitten:references:1';
  let fieldCache, objectCache, applyingState;
  function drawingPages() {
    const pages = documentType === 'spreadsheet' ? model.getSheets() : model.getDrawPages();
    return Array.from({ length: pages.getCount() }, (_, index) => documentType === 'spreadsheet' ? pages.getByIndex(index).getDrawPage() : pages.getByIndex(index));
  }
  function objectPayload(object) {
    if (!object.getPropertySetInfo().hasPropertyByName('UserDefinedAttributes')) return null;
    const attrs = object.getPropertyValue('UserDefinedAttributes');
    for (const key of attrs.getElementNames()) {
      const value = attrs.getByName(key);
      if (value.Namespace !== portableNamespace || key.split(':').at(-1) !== 'reference' || value.Value.length > 2 * 1024 * 1024) continue;
      try { const payload = JSON.parse(value.Value); if (payload.version === 1 && payload.citation?.id && (Array.isArray(payload.citation.items) || payload.bibliography)) return payload; } catch (_) {}
    }
    return null;
  }
  function portableObjects() {
    if (objectCache) return objectCache;
    objectCache = []; let visited = 0;
    if (documentType === 'spreadsheet') {
      const sheets = model.getSheets();
      for (let s = 0; s < sheets.getCount(); s++) {
        const owner = sheets.getByIndex(s), cursor = owner.createCursor(); cursor.gotoEndOfUsedArea(false);
        const end = cursor.getRangeAddress(), used = owner.getCellRangeByPosition(0, 0, end.EndColumn, end.EndRow);
        const formats = used.getUniqueCellFormatRanges();
        if (formats.getCount() > 10000) fail('Citation metadata inspection exceeds the native format-group bound');
        for (let f = 0; f < formats.getCount(); f++) {
          const ranges = formats.getByIndex(f).getRangeAddresses(); if (!ranges.length) continue;
          const sample = owner.getCellByPosition(ranges[0].StartColumn, ranges[0].StartRow), payload = objectPayload(sample);
          if (!payload) continue;
          for (const range of ranges) {
            if ((range.EndColumn - range.StartColumn + 1) * (range.EndRow - range.StartRow + 1) + objectCache.length > 10000) fail('Copied managed cells exceed the document citation bound');
            for (let row = range.StartRow; row <= range.EndRow; row++) for (let col = range.StartColumn; col <= range.EndColumn; col++) objectCache.push({ object: owner.getCellByPosition(col, row), payload, anchor: { kind: 'cell', nativeKey: s + ':' + row + ':' + col }, position: [s, row, col] });
          }
        }
      }
    }
    if (documentType === 'presentation' || documentType === 'spreadsheet') {
      const pages = drawingPages();
      function walk(collection, page, path) {
        for (let index = 0; index < collection.getCount(); index++) {
          if (++visited > 20000) fail('Citation metadata inspection exceeds the native shape bound');
          const object = collection.getByIndex(index), indices = [...path, index], payload = objectPayload(object);
          if (payload) objectCache.push({ object, parent: collection, payload, anchor: { kind: 'shape', name: object.getName(), nativeKey: (documentType === 'spreadsheet' ? 'shape:' : '') + page + ':' + indices.join('.') }, position: [page, ...indices] });
          if (object.supportsService('com.sun.star.drawing.GroupShape')) walk(object, page, indices);
        }
      }
      for (let page = 0; page < pages.length; page++) walk(pages[page], page, []);
    }
    return objectCache;
  }
  function writeObjectPayload(object, citation) {
    const attrs = object.getPropertyValue('UserDefinedAttributes');
    for (const key of attrs.getElementNames()) if (attrs.getByName(key).Namespace === portableNamespace && key.split(':').at(-1) === 'reference') attrs.removeByName(key);
    if (citation) attrs.insertByName('bk:reference', new css.xml.AttributeData({ Namespace: portableNamespace, Type: 'CDATA', Value: portablePayload(citation).slice(portablePrefix.length) }));
    object.setPropertyValue('UserDefinedAttributes', attrs); objectCache = null;
  }
  function portableFields() {
    if (fieldCache) return fieldCache;
    fieldCache = [];
    if (documentType !== 'text') return fieldCache;
    const fields = model.getTextFields().createEnumeration();
    let visited = 0;
    while (fields.hasMoreElements()) {
      if (++visited > 100000) fail('Native field inspection exceeds the document bound');
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
    const raw = has(propertyName) ? properties.getPropertyValue(propertyName) : null;
    if (raw !== null && (typeof raw !== 'string' || raw.length > 2 * 1024 * 1024)) fail('Embedded citation state exceeds the document bound');
    const state = raw === null ? { version: 1, revision: 0, citations: [], bibliography: null } : JSON.parse(raw);
    if (state.version !== 1 || !Array.isArray(state.citations) || state.citations.length > 10000) fail('The embedded citation state is invalid or requires another plugin version');
    const carriers = [...portableFields().map(({ field, payload }) => ({ payload, anchor: { kind: 'field', name: field.getName(), note: payload.citation.note || null }, key: field.getName() })), ...portableObjects().map(item => ({ ...item, key: item.anchor.nativeKey }))];
    const fieldOwners = new Map(carriers.filter(entry => entry.anchor.kind === 'field').map(entry => [entry.anchor.name, entry.payload.citation.id]));
    const groups = new Map();
    for (const carrier of carriers) { const id = carrier.payload.citation.id; if (!groups.has(id)) groups.set(id, []); groups.get(id).push(carrier); }
    function matchPrevious(group, previous) {
      const anchor = previous?.anchor; if (!anchor) return group[0];
      if (anchor.kind === 'cell' && anchor.name) {
        const names = model.getPropertyValue('NamedRanges');
        if (names.hasByName(anchor.name)) {
          const range = names.getByName(anchor.name).getReferredCells();
          if (range) { const a = range.getRangeAddress(), key = a.Sheet + ':' + a.StartRow + ':' + a.StartColumn; return group.find(entry => entry.key === key); }
          return undefined;
        }
      }
      const named = anchor.name ? group.filter(entry => entry.anchor.name === anchor.name) : [];
      if (named.length === 1) return named[0];
      // Native paste retains the original name and suffixes copies. If only
      // those copies remain, leave the deleted original missing. DOCX reload
      // may regenerate every field name, so unrelated names still adopt their
      // persisted payload identity rather than becoming new occurrences.
      // OOXML can regenerate Bookmark/Bookmark Copy N names in document order.
      // A name now owned by a different embedded occurrence proves that this
      // is a rename, rather than deletion of the original followed by a paste.
      const reassigned = anchor.kind === 'field' && fieldOwners.has(anchor.name) && fieldOwners.get(anchor.name) !== previous.id;
      if (!reassigned && anchor.name && group.every(entry => entry.anchor.name?.startsWith(anchor.name + (anchor.kind === 'field' ? ' Copy ' : ' ')))) return undefined;
      return group.find(entry => entry.anchor.nativeKey === anchor.nativeKey) || group[0];
    }
    for (const [original, group] of groups) {
      const bibliography = group[0].payload.bibliography;
      const previous = bibliography ? state.bibliography : state.citations.find(citation => citation.id === original);
      const owner = matchPrevious(group, previous) || (bibliography ? group[0] : undefined);
      const occurrences = [];
      for (const entry of group) {
        const { payload } = entry, citation = { ...payload.citation, anchor: { ...entry.anchor } };
        citation.id = bibliography ? 'bibliography' : entry === owner ? original : original + ':copy:' + entry.key;
        const old = bibliography ? (entry === owner ? previous : previous?.copies?.find(copy => entry.anchor.nativeKey && copy.anchor.nativeKey === entry.anchor.nativeKey || entry.anchor.name && copy.anchor.name === entry.anchor.name)) : state.citations.find(old => old.id === citation.id);
        citation.anchor.name ||= old?.anchor?.name;
        state.style ||= payload.style; state.libraryId ||= payload.libraryId; state.noteType ||= payload.noteType;
        state.embeddedItems = { ...(state.embeddedItems || {}), ...(payload.embeddedItems || {}) };
        if (bibliography) { occurrences.push(citation); continue; }
        const index = state.citations.findIndex(old => old.id === citation.id);
        if (index < 0) state.citations.push(citation); else state.citations[index] = citation;
      }
      if (bibliography) {
        const index = group.indexOf(owner), primary = occurrences[index];
        state.bibliography = { ...primary, copies: occurrences.filter((_, n) => n !== index) };
      }
    }
    return state;
  };
  function portablePayload(citation) {
    const state = applyingState || metadata(), embeddedItems = {};
    const items = citation.id === 'bibliography' ? Object.keys(state.embeddedItems || {}).map(id => ({ id })) : citation.items || [];
    for (const item of items) if (state.embeddedItems?.[item.id]) embeddedItems[item.id] = state.embeddedItems[item.id];
    const { anchor, target, runs, rendered, missing, copies, ...occurrence } = citation;
    return portablePrefix + JSON.stringify({ version: 1, citation: occurrence, bibliography: citation.id === 'bibliography', style: state.style, noteType: state.noteType, libraryId: state.libraryId, embeddedItems });
  }
  function nativeMark(citation) {
    return portableFields().find(item => item.field.getName() === citation.anchor.name &&
      (item.payload.citation.id === citation.id || item.payload.citation.id + ':copy:' + item.field.getName() === citation.id))?.field;
  }
  const persist = state => {
    if (state) state.revision += 1;
    const value = state ? JSON.stringify(state) : null;
    if (value?.length > 2 * 1024 * 1024) fail('Embedded citation metadata exceeds the document bound');
    const property = (name, value) => new css.beans.PropertyValue({ Name: name, Handle: 0, Value: value, State: css.beans.PropertyState.DIRECT_VALUE });
    const sequence = uno.type.sequence(uno.type.struct(css.beans.PropertyValue));
    const updated = [property('NamePrefix', propertyName), property('UserDefinedProperties', new uno.Any(sequence, value === null ? [] : [property(propertyName, value)]))];
    // Native SetDocumentProperties participates in the same undo context through
    // the isolated generic property-undo patch, and outlives this participant.
    css.frame.DispatchHelper.create(uno.componentContext).executeDispatch(view.getFrame(), '.uno:SetDocumentProperties', '', 0, [property('UpdatedProperties', new uno.Any(sequence, updated))]);
    return state;
  };
  const checkRevision = state => {
    if (request.expectedRevision !== state.revision) fail('Citation state changed; read it again before applying this operation');
  };
  function checkBoundLibrary(current, desired) {
    if (desired?.bindingVersion !== 1 || !desired.libraryId || !desired.style?.id) fail('Choose a document project library and citation style first');
    if (current.bindingVersion !== 1 && request.configure !== true) fail('Choose a document project library and citation style first');
    if (desired.libraryId !== current.libraryId) fail('Change the project library through the explicit binding operation');
  }
  const requireType = type => { if (type !== documentType) fail('Operation requires ' + type); };
  function writerOwner(target) {
    return target?.table ? model.getTextTables().getByName(text(target.table, 80)).getCellByName(text(target.cell, 30)) : model.getText();
  }
  function paragraph(index, owner = model.getText()) {
    requireType('text'); integer(index, 0, 100000, 'paragraph index');
    const enumeration = owner.createEnumeration();
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
    if (target?.selection) return view.getViewCursor();
    const para = paragraph(target?.paragraph ?? 0, writerOwner(target));
    const value = para.getString();
    if (target.expectedText !== undefined && target.expectedText !== value) fail('Paragraph changed; refresh before editing');
    const offset = integer(target.offset ?? value.length, 0, value.length, 'text offset');
    const length = integer(target.length ?? 0, 0, value.length - offset, 'text length');
    function at(position) {
      const cursor = para.getText().createTextCursorByRange(para.getStart());
      if (position === value.length) { cursor.gotoRange(para.getEnd(), false); return cursor; }
      cursor.goRight(position, true);
      // Native field delimiters occupy cursor positions but are not rendered
      // in XTextRange.getString(). Resolve the public rendered-text offset.
      let consumed = cursor.getString().length, attempts = 0;
      while (consumed < position) {
        if (++attempts > 30000 || !cursor.goRight(position - consumed, true)) fail('Cannot resolve the native text position');
        const next = cursor.getString().length; if (next > position) fail('The requested offset crosses a native field boundary'); consumed = next;
      }
      cursor.collapseToEnd(); return cursor;
    }
    const cursor = at(offset); if (length) cursor.gotoRange(at(offset + length), true);
    return cursor;
  }
  function sheet(name) {
    requireType('spreadsheet');
    const sheets = model.getSheets();
    if (typeof name === 'string') return sheets.getByName(name);
    return sheets.getByIndex(integer(name ?? 0, 0, sheets.getCount() - 1, 'sheet index'));
  }
  function cell(target) {
    if (target?.selection) return view.getSelection();
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
  function anchorName(id) { return 'BKREF_' + text(id, 4096).replace(/[^a-zA-Z0-9]/g, '').slice(0, 32); }
  function uniqueShapeName(id, target) {
    const names = new Set(); let visited = 0;
    function collect(page) {
      for (let index = 0; index < page.getCount(); index++) {
        if (++visited > 20000) fail('Native shape name inspection exceeds the document bound');
        const shape = page.getByIndex(index); if (shape !== target) names.add(shape.getName());
        if (shape.supportsService('com.sun.star.drawing.GroupShape')) collect(shape);
      }
    }
    for (const page of drawingPages()) collect(page);
    const base = anchorName(id); let name = base, suffix = 0;
    while (names.has(name)) name = base + ' ' + (++suffix);
    return name;
  }
  function portableMatch(item, citation) {
    return item.anchor.nativeKey === citation.anchor.nativeKey && (item.payload.citation.id === citation.id || item.payload.citation.id + ':copy:' + item.anchor.nativeKey === citation.id);
  }
  function anchorFor(citation) {
    if (citation.anchor.kind === 'field') return nativeMark(citation)?.getAnchor() || null;
    if (citation.anchor.nativeKey) { const native = portableObjects().find(item => portableMatch(item, citation))?.object; if (native) return native; }
    if (citation.anchor.kind === 'cell') {
      const names = model.getPropertyValue('NamedRanges');
      if (!names.hasByName(citation.anchor.name)) return null;
      const anchor = names.getByName(citation.anchor.name).getReferredCells(); if (!anchor) return null;
      const payload = objectPayload(anchor);
      return payload?.citation.id === citation.id ? anchor : null;
    }
    if (citation.anchor.kind === 'shape') {
      const pages = drawingPages();
      for (let p = 0; p < pages.length; p++) for (let s = 0; s < pages[p].getCount(); s++) {
        const shape = pages[p].getByIndex(s);
        if (shape.getName() === citation.anchor.name) { const payload = objectPayload(shape); return payload?.citation.id === citation.id ? shape : null; }
      }
      return null;
    }
    return null;
  }
  function assertTextShapeAvailable(shape) {
    if (!shape || typeof shape.getShapeType !== 'function' || typeof shape.getString !== 'function') return;
    if (!shape.getPropertySetInfo().hasPropertyByName('TextEditActive')) fail('Office native active-text inspection is unavailable for this shape');
    if (shape.getPropertyValue('TextEditActive')) fail('Shape text is being edited in a native view');
  }
  function preflightCitationShapes(state, desired) {
    // The entire operation is synchronous under the native SolarMutex. Check
    // every existing target before any write, including copies/removals and
    // untagged text shapes being promoted from citation codes.
    for (const citation of [...state.citations, ...bibliographies(state)]) {
      if (citation.anchor?.kind === 'shape') assertTextShapeAvailable(anchorFor(citation));
    }
    for (const citation of [...(desired?.citations || []), ...(desired?.bibliography ? [desired.bibliography, ...(desired.bibliography.copies || [])] : [])]) {
      if (citation.target?.existingShape) assertTextShapeAvailable(findShape(citation.target));
    }
  }
  function rendered(citation) { const anchor = anchorFor(citation); return anchor ? anchor.getString() : null; }
  function writerLocation(range) {
    let location = range;
    try { if (range.getText().supportsService('com.sun.star.text.Footnote')) location = range.getText().getAnchor(); } catch (_) {}
    let visited = 0;
    function locate(owner, target, prefix, depth) {
      if (depth > 16) fail('Native text nesting exceeds the inspection bound');
      const enumeration = owner.createEnumeration(); let index = 0, elementIndex = 0;
      while (enumeration.hasMoreElements()) {
        if (++visited > 100000) fail('Native text inspection exceeds the paragraph bound');
        const element = enumeration.nextElement(), order = [...prefix, elementIndex++];
        if (element.supportsService('com.sun.star.text.TextTable')) {
          const names = element.getCellNames();
          for (let cell = 0; cell < names.length; cell++) {
            const found = locate(element.getCellByName(names[cell]), { table: element.getName(), cell: names[cell] }, [...order, cell], depth + 1);
            if (found) return found;
          }
        } else if (element.supportsService('com.sun.star.text.Paragraph')) {
          try {
            const textOwner = element.getText();
            if (textOwner.compareRegionStarts(element.getStart(), location.getStart()) >= 0 && textOwner.compareRegionStarts(element.getEnd(), location.getStart()) <= 0) {
              const cursor = textOwner.createTextCursorByRange(element.getStart()); cursor.gotoRange(location.getStart(), true);
              const offset = cursor.getString().length;
              return { ...target, paragraph: index, offset, length: location.getString().length, expectedText: element.getString(), order: [...order, offset] };
            }
          } catch (error) { if (!String(error.message).includes('IllegalArgument')) throw error; }
          index++;
        }
      }
      return null;
    }
    return locate(model.getText(), {}, [], 0) || fail('The native text location is outside the document body or its tables');
  }
  function selectionTarget() {
    const controller = view;
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
    if (citation.anchor?.nativeKey) { const found = portableObjects().find(item => portableMatch(item, citation)); if (found) return found.position; }
    if (documentType === 'text') {
      return writerLocation(anchor || writerRange(citation.target)).order;
    }
    if (documentType === 'spreadsheet' && citation.anchor?.kind !== 'shape') {
      const address = (anchor || cell(citation.target)).getRangeAddress(); return [address.Sheet, address.StartRow, address.StartColumn];
    }
    if (anchor) {
      const pages = drawingPages();
      for (let p = 0; p < pages.length; p++) for (let n = 0; n < pages[p].getCount(); n++) if (pages[p].getByIndex(n).getName() === anchor.getName()) return [p, n];
    }
    return [citation.target?.slide ?? 0, Number.MAX_SAFE_INTEGER];
  }
  function orderCitations(citations) {
    const order = new Map(citations.map(c => [c.id, orderPosition(c)]));
    return citations.sort((a, b) => { const x = order.get(a.id), y = order.get(b.id); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; });
  }
  function snapshot(state) {
    const entries = [...state.citations, ...bibliographies(state)].map(c => ({ id: c.id, rendered: rendered(c), position: anchorFor(c) ? orderPosition(c) : null }));
    // Inspection presents native document order; embedded state may still have
    // the old order after a native paste/move. Compare the same set of anchors.
    entries.sort((a, b) => (a.id + JSON.stringify(a.position)).localeCompare(b.id + JSON.stringify(b.position)));
    return JSON.stringify(entries);
  }
  function bibliographies(state) { return state.bibliography?.anchor ? [state.bibliography, ...(state.bibliography.copies || [])] : []; }
  function inspectCitations() {
    const state = metadata();
    state.citations = state.citations.map(c => ({ ...c, rendered: rendered(c), missing: !anchorFor(c) }));
    if (state.bibliography?.anchor) state.bibliography = { ...state.bibliography, rendered: rendered(state.bibliography), missing: !anchorFor(state.bibliography), copies: (state.bibliography.copies || []).map(copy => ({ ...copy, rendered: rendered(copy), missing: !anchorFor(copy) })) };
    const live = state.citations.filter(c => !c.missing);
    state.citations = [...orderCitations(live), ...state.citations.filter(c => c.missing)];
    state.nativeSnapshot = snapshot(state);
    state.binding = state.bindingVersion === 1 && state.libraryId && state.style?.id ? { projectId: state.libraryId, style: state.style } : null;
    return state;
  }
  function selectedCitations() {
    const state = inspectCitations(), selected = view.getSelection(), ranges = [];
    // XSelectionSupplier returns Writer text ranges, Calc cells/ranges, or
    // Impress shapes. During Impress text editing it returns an XTextRange;
    // that range's XText is the native shape, not a second text object.
    function collect(selection) {
      if (!selection) return;
      if (typeof selection.getRangeAddress === 'function' || typeof selection.getShapeType === 'function' || typeof selection.getText === 'function') { ranges.push(selection); return; }
      if (typeof selection.getCount === 'function' && typeof selection.getByIndex === 'function') {
        const count = selection.getCount();
        if (count > 10000) fail('Native selection exceeds the citation inspection bound');
        for (let index = 0; index < count; index++) collect(selection.getByIndex(index));
      }
    }
    collect(selected);
    function textIntersects(range, anchor) {
      const owner = range.getText();
      if (!uno.sameUnoObject(owner, anchor.getText())) return false;
      // Native compareRegionStarts returns +1 when its first range is earlier.
      // A caret at either field edge belongs to that field, but a nonempty
      // selection merely touching the edge does not select the citation.
      const collapsed = owner.compareRegionStarts(range.getStart(), range.getEnd()) === 0;
      const beforeEnd = owner.compareRegionStarts(range.getStart(), anchor.getEnd());
      const afterStart = owner.compareRegionStarts(range.getEnd(), anchor.getStart());
      return collapsed ? beforeEnd >= 0 && afterStart <= 0 : beforeEnd > 0 && afterStart < 0;
    }
    function matches(range, citation, anchor) {
      if (citation.anchor.kind === 'field') {
        if (typeof range.getText !== 'function') return false;
        if (textIntersects(range, anchor)) return true;
        // The superscript note mark is another native part of a note citation.
        const owner = anchor.getText();
        return citation.anchor.note && owner.supportsService('com.sun.star.text.Footnote') && textIntersects(range, owner.getAnchor());
      }
      if (citation.anchor.kind === 'cell') {
        if (typeof range.getRangeAddress !== 'function') return false;
        const a = anchor.getRangeAddress(), b = range.getRangeAddress();
        return a.Sheet === b.Sheet && a.StartColumn <= b.EndColumn && a.EndColumn >= b.StartColumn && a.StartRow <= b.EndRow && a.EndRow >= b.StartRow;
      }
      return uno.sameUnoObject(anchor, range) || typeof range.getText === 'function' && uno.sameUnoObject(anchor, range.getText());
    }
    const citations = state.citations.filter(citation => {
      const anchor = !citation.missing && anchorFor(citation);
      return anchor && ranges.some(range => matches(range, citation, anchor));
    });
    const citation = citations.length === 1 ? citations[0] : null;
    return { documentType, revision: state.revision, nativeSnapshot: state.nativeSnapshot, ids: citations.map(citation => citation.id), ambiguous: citations.length > 1, citationId: citation?.id || null, citation };
  }
  function intersectsManaged(range) {
    const state = metadata();
    for (const citation of [...state.citations, ...bibliographies(state)]) {
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
        if (citation.anchor.kind === 'shape' || typeof range.getRangeAddress !== 'function') {
          if (citation.anchor.kind === 'shape' && typeof range.getName === 'function' && anchor.getName() === range.getName()) return true;
          continue;
        }
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
    cursor.setPropertyValue('CharCaseMap', short(css.style.CaseMap.NONE));
    const supportsLink = cursor.getPropertySetInfo().hasPropertyByName('HyperLinkURL');
    if (supportsLink) cursor.setPropertyValue('HyperLinkURL', '');
    let offset = 0; const links = [];
    function styleRun(cursor, run) {
      if (run.italic) cursor.setPropertyValue('CharPosture', css.awt.FontSlant.ITALIC);
      if (run.bold) cursor.setPropertyValue('CharWeight', new uno.Any(uno.type.float, 150));
      if (run.superscript) { cursor.setPropertyValue('CharEscapement', short(33)); cursor.setPropertyValue('CharEscapementHeight', new uno.Any(uno.type.byte, 58)); }
      if (run.subscript) { cursor.setPropertyValue('CharEscapement', short(-33)); cursor.setPropertyValue('CharEscapementHeight', new uno.Any(uno.type.byte, 58)); }
      if (run.underline) cursor.setPropertyValue('CharUnderline', short(1));
      if (run.smallCaps) cursor.setPropertyValue('CharCaseMap', short(css.style.CaseMap.SMALLCAPS));
    }
    for (const run of runs ?? []) {
      if (!run.text || offset + run.text.length > full.length) continue;
      cursor.gotoRange(range.getStart(), false); cursor.goRight(offset, false); cursor.goRight(run.text.length, true);
      styleRun(cursor, run);
      if (run.url && supportsLink) cursor.setPropertyValue('HyperLinkURL', run.url);
      else if (run.url) links.push({ offset, run });
      offset += run.text.length;
    }
    // Calc/Impress expose links as their native URL text fields, not Writer's
    // HyperLinkURL cursor property. Insert from the end because a field has
    // one native character position while its rendered label may be longer.
    for (const { offset, run } of links.reverse()) {
      cursor.gotoRange(range.getStart(), false); cursor.goRight(offset, false); cursor.goRight(run.text.length, true);
      const field = model.createInstance('com.sun.star.text.TextField.URL');
      field.setPropertyValue('URL', run.url); field.setPropertyValue('Representation', run.text);
      owner.insertTextContent(cursor, field, true);
      const anchor = field.getAnchor(), styled = owner.createTextCursorByRange(anchor.getStart()); styled.gotoRange(anchor.getEnd(), true); styleRun(styled, run);
    }
  }
  function setRichText(anchor, citation) {
    if (!citation.runs?.some(run => run.lineBreak)) { anchor.setString(citation.text); return; }
    anchor.setString(''); const owner = anchor.getText(), cursor = owner.createTextCursor();
    for (const run of citation.runs) {
      if (run.lineBreak && run.text) owner.insertControlCharacter(cursor, css.text.ControlCharacter.LINE_BREAK, false);
      else owner.insertString(cursor, run.text, false);
      cursor.gotoEnd(false);
    }
  }
  function bibliographyParagraphs(range) {
    const owner = range.getText ? range.getText() : range, enumeration = owner.createEnumeration(), result = []; let visited = 0;
    while (enumeration.hasMoreElements()) {
      if (++visited > 100000) fail('Bibliography paragraph inspection exceeds the document bound');
      const paragraph = enumeration.nextElement();
      if (!paragraph.supportsService('com.sun.star.text.Paragraph')) continue;
      if (documentType === 'text' && (owner.compareRegionStarts(paragraph.getEnd(), range.getStart()) > 0 || owner.compareRegionStarts(paragraph.getStart(), range.getEnd()) < 0)) continue;
      const cursor = owner.createTextCursorByRange(paragraph.getStart()); cursor.gotoRange(paragraph.getEnd(), true); result.push(cursor);
      if (result.length > 10000) fail('Bibliography paragraphs exceed the document bound');
    }
    return result;
  }
  function paragraphLayout(cursor) {
    const get = key => cursor.getPropertyValue(key), line = get('ParaLineSpacing');
    return { left: get('ParaLeftMargin'), first: get('ParaFirstLineIndent'), top: get('ParaTopMargin'), bottom: get('ParaBottomMargin'), line: { Mode: line.Mode, Height: line.Height }, tabs: get('ParaTabStops').map(tab => ({ Position: tab.Position, Alignment: tab.Alignment, DecimalChar: tab.DecimalChar, FillChar: tab.FillChar })) };
  }
  function bibliographyLayout(citation, anchor, previous, saved) {
    if (!citation.format || !anchor) return;
    // Zotero's native Cite.getBibliographyFormatParameters supplies twips. UNO
    // paragraph margins/tab stops use 1/100 mm and proportional line spacing
    // uses percent. Preserve each existing entry's native customizations until
    // a style/format change, as Zotero's bibliographyStyleHasBeenSet does.
    const mm = twips => Math.round(twips * 2540 / 1440), format = citation.format;
    const relativeTabs = documentType !== 'text' || model.createInstance('com.sun.star.document.Settings').getPropertyValue('TabsRelativeToIndent');
    const base = { left: mm(format.indent), first: mm(format.firstLineIndent), top: 0, bottom: mm(format.entrySpacing), line: { Mode: css.style.LineSpacingMode.PROP, Height: Math.round(format.lineSpacing * 100 / 240) }, tabs: format.tabStops.map(value => ({ Position: mm(value) - (relativeTabs ? mm(format.indent) : 0), Alignment: css.style.TabAlign.LEFT, DecimalChar: '.', FillChar: ' ' })) };
    const oldIds = previous?.entryIds?.map(ids => JSON.stringify(ids)) || [];
    bibliographyParagraphs(anchor).forEach((cursor, index) => {
      const oldIndex = citation.entryIds?.[index] ? oldIds.indexOf(JSON.stringify(citation.entryIds[index])) : index;
      const layout = saved?.[oldIndex] || saved?.[0] || base;
      for (const [key, value] of [['ParaLeftMargin', layout.left], ['ParaFirstLineIndent', layout.first], ['ParaTopMargin', layout.top], ['ParaBottomMargin', layout.bottom]]) cursor.setPropertyValue(key, new uno.Any(uno.type.long, value));
      cursor.setPropertyValue('ParaLineSpacing', new css.style.LineSpacing(layout.line));
      cursor.setPropertyValue('ParaTabStops', new uno.Any(uno.type.sequence(uno.type.struct(css.style.TabStop)), layout.tabs.map(tab => new css.style.TabStop(tab))));
    });
  }
  function writeAnchor(citation, target, replace, preparedTarget, previous) {
    let anchor = replace ? anchorFor(citation) : null;
    if (replace && !anchor) fail('Citation anchor was deleted; refresh the document state');
    const isBibliography = citation.id === 'bibliography';
    // Calc deliberately strips paragraph attributes from cell rich text in its
    // native PutDataOperation. A bibliography uses a normal cell-anchored text
    // shape so hanging indents, spacing and tab stops survive save/reopen.
    if (isBibliography && documentType === 'spreadsheet' && citation.anchor?.kind === 'cell') {
      const address = anchor.getRangeAddress(); target = { sheet: address.Sheet, range: anchor.getPropertyValue('AbsoluteName').split('.').at(-1) };
      removeAnchor(citation, false); anchor = null; citation.anchor = undefined;
    }
    const savedLayout = isBibliography && anchor && previous?.layoutStyle === citation.layoutStyle ? bibliographyParagraphs(anchor).map(paragraphLayout) : null;
    if (documentType === 'text') {
      const controller = view, frame = controller.getFrame();
      const property = (Name, Value) => new css.beans.PropertyValue({ Name, Value, Handle: 0, State: css.beans.PropertyState.DIRECT_VALUE });
      const sequence = uno.type.sequence(uno.type.struct(css.beans.PropertyValue));
      const fieldType = 'vnd.oasis.opendocument.field.UNHANDLED';
      const escapeHTML = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const richHTML = (citation.runs || [{ text: citation.text }]).map(run => {
        if (run.lineBreak) return run.text ? '<br>' : '';
        return run.text.split('\n').map(part => {
        let out = escapeHTML(part).replace(/\t/g, '&#9;');
        for (const [flag, tag] of [['italic', 'i'], ['bold', 'b'], ['superscript', 'sup'], ['subscript', 'sub'], ['underline', 'u']]) if (run[flag]) out = '<' + tag + '>' + out + '</' + tag + '>';
        if (run.url && /^(https?:|mailto:)/i.test(run.url)) out = '<a href="' + escapeHTML(run.url) + '">' + out + '</a>';
        if (run.smallCaps) out = '<span style="font-variant:small-caps">' + out + '</span>';
        return out;
      }).join(isBibliography ? '</p><p>' : '<br>'); }).join('');
      const html = isBibliography ? '<p>' + richHTML + '</p>' : citation.html || richHTML;
      const fieldCommand = portablePayload(citation);
      const fields = [property('FieldType', fieldType), property('FieldCommand', fieldCommand), property('FieldResult', html)];
      const dispatch = css.frame.DispatchHelper.create(uno.componentContext);
      const sameNote = anchor && (citation.anchor.note || null) === (citation.note || null);
      if (sameNote && citation.anchor.kind === 'field') {
        // Zotero skips unchanged citation text; Refresh still rewrites its
        // bibliography. Our portable command must also match so copied fields
        // and refreshed embedded metadata
        // still use the native undo-aware command update when needed.
        if (!isBibliography && anchor.getString() === citation.text && nativeMark(citation).getParameters().getByName('vnd.oasis.opendocument.field.code') === fieldCommand) return citation;
        const cursor = anchor.getText().createTextCursorByRange(anchor.getStart()); cursor.goRight(1, false); controller.select(cursor);
        dispatch.executeDispatch(frame, '.uno:UpdateTextFormField', '', 0, [property('FieldType', fieldType), property('FieldCommandPrefix', portablePrefix), property('Field', new uno.Any(sequence, fields))]);
      } else {
        let range = preparedTarget || (!anchor ? writerRange(target || {}) : null);
        if (anchor) {
          const oldNote = citation.anchor.note ? anchor.getText() : null, oldRange = oldNote ? oldNote.getAnchor() : anchor;
          range = oldRange.getText().createTextCursorByRange(oldRange.getStart());
          if (!oldNote) range.gotoRange(oldRange.getEnd(), true);
          const oldContent = oldNote && oldNote.createTextCursorByRange(anchor.getStart());
          if (oldContent) oldContent.gotoRange(anchor.getEnd(), true);
          nativeMark(citation).dispose(); fieldCache = null;
          if (oldNote) { oldContent.setString(''); if (!oldNote.getString().trim()) oldRange.getText().removeTextContent(oldNote); }
        } else if (intersectsManaged(range)) fail('The insertion target overlaps a managed citation');
        range.setString(''); controller.select(range);
        if (citation.note) fields.push(property('Wrapper', citation.note === 'endnote' ? 'Endnote' : 'Footnote'));
        dispatch.executeDispatch(frame, '.uno:TextFormField', '', 0, fields);
      }
      fieldCache = null;
      const installed = portableFields().find(item => item.payload.citation.id === citation.id && (!sameNote || item.field.getName() === citation.anchor.name)) || portableFields().find(item => item.payload.citation.id === citation.id);
      if (!installed) fail('Native Office did not acknowledge the managed field');
      citation.anchor = { kind: 'field', name: installed.field.getName(), note: citation.note || null };
    } else if (documentType === 'spreadsheet' && !isBibliography) {
      if (!anchor) {
        anchor = cell(target);
        if (intersectsManaged(anchor)) fail('This cell already contains a managed citation');
        if (target?.expectedText !== undefined && anchor.getString() !== target.expectedText) fail('Cell changed; refresh before insertion');
        citation.anchor = { kind: 'cell' };
      }
      const names = model.getPropertyValue('NamedRanges');
      if (!citation.anchor.name || !names.hasByName(citation.anchor.name)) {
        const base = anchorName(citation.id); let name = base, suffix = 0;
        while (names.hasByName(name)) name = base + '_' + (++suffix);
        const address = anchor.getRangeAddress();
        names.addNewByName(name, anchor.getPropertyValue('AbsoluteName'), new css.table.CellAddress({ Sheet: address.Sheet, Column: address.StartColumn, Row: address.StartRow }), 0);
        citation.anchor.name = name;
      }
      setRichText(anchor, citation); applyRuns(anchor, citation.runs); writeObjectPayload(anchor, citation);
    } else if (documentType === 'presentation' || documentType === 'spreadsheet') {
      if (!anchor) {
        const spreadsheet = documentType === 'spreadsheet', page = spreadsheet ? sheet(target?.sheet).getDrawPage() : slide(target?.slide);
        if (target?.existingShape) {
          anchor = findShape(target);
          if (intersectsManaged(anchor) || anchor.getString() !== target.expectedText) fail('The citation code shape changed');
        } else { anchor = model.createInstance('com.sun.star.drawing.TextShape'); page.add(anchor); anchor.setPropertyValue('TextAutoGrowHeight', isBibliography); anchor.setPropertyValue('TextAutoGrowWidth', false); }
        anchor.setName(uniqueShapeName(citation.id, anchor));
        const nativeCell = spreadsheet ? cell(target) : null, position = nativeCell?.getPropertyValue('Position');
        if (nativeCell) anchor.setPropertyValue('Anchor', nativeCell);
        if (!target?.existingShape) anchor.setPosition(new css.awt.Point({ X: integer(target?.x ?? position?.X ?? 1000, 0, 2000000, 'x'), Y: integer(target?.y ?? position?.Y ?? 1000, 0, 2000000, 'y') }));
        if (!target?.existingShape) anchor.setSize(new css.awt.Size({ Width: integer(target?.width ?? 18000, 100, 200000, 'width'), Height: integer(target?.height ?? 2000, 100, 200000, 'height') }));
        citation.anchor = { kind: 'shape', name: anchor.getName() };
      }
      setRichText(anchor, citation); applyRuns(anchor, citation.runs); writeObjectPayload(anchor, citation);
    } else fail('Unsupported document family');
    if (isBibliography) bibliographyLayout(citation, anchorFor(citation), previous, savedLayout);
    return citation;
  }
  function removeAnchor(citation, unlink) {
    const anchor = anchorFor(citation);
    if (!anchor) {
      if (citation.anchor.kind === 'cell' && citation.anchor.name) {
        const names = model.getPropertyValue('NamedRanges');
        if (names.hasByName(citation.anchor.name)) names.removeByName(citation.anchor.name);
      }
      return;
    }
    if (documentType === 'text') {
      const mark = nativeMark(citation);
      const note = citation.anchor.note && !unlink ? anchor.getText() : null;
      const range = anchor.getText().createTextCursorByRange(anchor.getStart()); range.gotoRange(anchor.getEnd(), true);
      mark.dispose(); fieldCache = null;
      if (!unlink) range.setString('');
      if (note && !note.getString().trim()) note.getAnchor().getText().removeTextContent(note);
    } else if (citation.anchor.kind === 'cell') {
      if (!unlink) anchor.setString(''); writeObjectPayload(anchor, null);
      const names = model.getPropertyValue('NamedRanges'); if (citation.anchor.name && names.hasByName(citation.anchor.name)) names.removeByName(citation.anchor.name);
    } else if (!unlink) {
      const native = portableObjects().find(item => portableMatch(item, citation));
      if (native?.parent) { native.parent.remove(anchor); objectCache = null; return; }
      const pages = drawingPages();
      for (const page of pages) for (let s = 0; s < page.getCount(); s++) if (page.getByIndex(s).getName() === citation.anchor.name) { page.remove(anchor); return; }
    } else writeObjectPayload(anchor, null);
  }
  const operation = request.operation;
  if (operation === 'capabilities') return { documentType, format: /\.(docx|odt|xlsx|ods|pptx|odp)$/i.exec(model.getURL())?.[1].toLowerCase() || ({ text: 'odt', spreadsheet: 'ods', presentation: 'odp' })[documentType], adapterVersion: 1, preferredModel: false, nativeUno: true, citations: true, boundedInspection: true };
  if (operation === 'selection') return { documentType, target: selectionTarget() };
  if (operation === 'codes.region') {
    if (documentType === 'text') {
      const target = request.target || selectionTarget(), para = paragraph(target.paragraph, writerOwner(target));
      const style = para.getPropertyValue('ParaStyleName');
      return { documentType, text: para.getString(), target: { paragraph: target.paragraph, ...(target.table ? { table: target.table, cell: target.cell } : {}) }, codeStyle: /(?:code|preformatted|source)/i.test(style) };
    }
    if (documentType === 'spreadsheet') {
      const target = request.target || selectionTarget(), value = cell(target);
      return { documentType, text: value.getString(), target, formula: value.getFormula().startsWith('=') };
    }
    let target = request.target;
    if (!target) {
      const selection = view.getSelection();
      if (!selection || typeof selection.getCount !== 'function' || selection.getCount() !== 1) return { documentType, text: '', unavailable: 'Select one text shape' };
      const shape = selection.getByIndex(0); target = { ...selectionTarget(), name: shape.getName() };
    }
    const shape = findShape(target);
    return { documentType, text: shape.getString(), target: { ...target, existingShape: true } };
  }
  if (operation === 'citations.inspect') return inspectCitations();
  if (operation === 'citations.selection') return selectedCitations();
  if (operation === 'citations.prepare') {
    const current = metadata(); checkRevision(current);
    const desired = request.state;
    checkBoundLibrary(current, desired);
    if (desired.nativeSnapshot !== undefined && desired.nativeSnapshot !== snapshot(current)) fail('Native citation positions or text changed; inspect before preparing this operation');
    const removedNotes = documentType === 'text' ? current.citations.filter(old => old.anchor?.note && !desired.citations.some(citation => citation.id === old.id)).map(old => anchorFor(old)).filter(anchor => anchor && anchor.getString().trim() === anchor.getText().getString().trim()).map(anchor => anchor.getText()) : [];
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
          const nativeAnchor = notes.getByIndex(n).getAnchor();
          if (removedNotes.some(note => nativeAnchor.getText().compareRegionStarts(nativeAnchor, note.getAnchor()) === 0)) continue;
          const pos = writerLocation(nativeAnchor);
          for (let i = 0; i < Math.max(pos.order.length, at.length); i++) {
            if ((pos.order[i] || 0) < (at[i] || 0)) { preceding++; break; }
            if ((pos.order[i] || 0) > (at[i] || 0)) break;
          }
        }
        citation.noteIndex = preceding + addedNotes + 1;
        if (citation.anchor?.note !== (desired.noteType || 'footnote')) addedNotes++;
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
  if (operation === 'view.finish-edit') {
    // Explicit confirmation only: use this participant's existing controller
    // to commit its native text edit before starting the citation undo group.
    // Other participants' active editors are never selected or ended here.
    if (documentType === 'spreadsheet') view.select(view.getSelection());
    else if (documentType === 'presentation') css.frame.DispatchHelper.create(uno.componentContext).executeDispatch(view.getFrame(), '.uno:SelectObject', '', 0, []);
    return { finishedOwnEdit: true };
  }
  if (operation === 'native.uno') {
    if (typeof request.command !== 'string' || !/^\.uno:[A-Za-z0-9_]+$/.test(request.command)) fail('A native .uno command is required');
    const types = { string: uno.type.string, boolean: uno.type.boolean, short: uno.type.short, long: uno.type.long, float: uno.type.float, double: uno.type.double };
    const args = (request.arguments || []).map(argument => {
      if (!types[argument.type]) fail('Unsupported UNO value type; use native.script for structured native values');
      return new css.beans.PropertyValue({ Name: text(argument.name, 100), Handle: 0, Value: new uno.Any(types[argument.type], argument.value), State: css.beans.PropertyState.DIRECT_VALUE });
    });
    const result = css.frame.DispatchHelper.create(uno.componentContext).executeDispatch(view.getFrame(), request.command, '', 0, args);
    return { dispatched: request.command, result };
  }
  const undo = model.getUndoManager(), undoTitle = 'References / Pi: ' + operation + ' ' + Date.now();
  const previousMetadata = has(propertyName) ? properties.getPropertyValue(propertyName) : null;
  let failed = false;
  undo.enterUndoContext(undoTitle);
  try {
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
      const range = sheet(request.sheet).getCellRangeByName(text(request.range, 80, 'sheet.set command.range: use a string such as "A1:B2" or a native named range; sheet and values/formulas belong directly in command'));
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
      assertTextShapeAvailable(shape);
      if (request.expectedText !== undefined && shape.getString() !== request.expectedText) fail('Shape text changed');
      if (request.text !== undefined) shape.setString(text(request.text));
      if (request.position) shape.setPosition(new css.awt.Point({ X: request.position.x, Y: request.position.y }));
      if (request.size) shape.setSize(new css.awt.Size({ Width: request.size.width, Height: request.size.height }));
      return { edited: true };
    }
    if (operation === 'format') {
      const allowed = ['CharColor', 'CharHeight', 'CharFontName', 'CharWeight', 'CharPosture', 'CellBackColor', 'NumberFormat', 'ParaAdjust', 'ParaStyleName', 'FillColor', 'FillTransparence'];
      const target = documentType === 'text' ? writerRange(request.target) : documentType === 'spreadsheet' ? sheet(request.target.sheet).getCellRangeByName(request.target.range) : findShape(request.target);
      assertTextShapeAvailable(target);
      for (const [name, value] of Object.entries(request.properties || {})) { if (!allowed.includes(name)) fail('Unsupported property ' + name); target.setPropertyValue(name, value); }
      return { formatted: true };
    }
    if (operation === 'citations.bind') {
      const state = metadata(); checkRevision(state);
      const projectId = text(request.projectId, 128);
      if (!projectId || !request.style?.id || typeof request.style.id !== 'string') fail('Choose a project library and citation style');
      if (request.nativeSnapshot !== snapshot(state)) fail('Native citation positions or text changed; inspect before changing the document library');
      const managed = [...state.citations, ...bibliographies(state)].filter(citation => anchorFor(citation));
      if (managed.length && state.libraryId !== projectId && request.convertExistingToText !== true) fail('Confirm conversion of existing citations and bibliography to ordinary formatted content before changing libraries');
      if (managed.length && state.libraryId === projectId) fail('Refresh the existing citations when changing the bound library style');
      preflightCitationShapes(state);
      // Unlink only: preserve all native characters, fields' displayed runs,
      // paragraph/cell/shape formatting, notes and bibliography layout.
      for (const citation of [...state.citations, ...bibliographies(state)]) removeAnchor(citation, true);
      persist({ version: 1, revision: state.revision, bindingVersion: 1, libraryId: projectId, projectId, style: request.style, noteType: request.noteType || state.noteType || 'footnote', metadataSource: 'library', citations: [], bibliography: null });
      return inspectCitations();
    }
    if (operation === 'citations.apply') {
      const state = metadata(); checkRevision(state);
      if (!request.state || request.state.version !== 1 || !Array.isArray(request.state.citations) || request.state.citations.length > 10000) fail('Invalid citation state');
      const desired = request.state;
      checkBoundLibrary(state, desired);
      delete desired.binding;
      preflightCitationShapes(state, desired);
      applyingState = desired;
      if (desired.nativeSnapshot !== undefined && desired.nativeSnapshot !== snapshot(state)) fail('Native citation positions or text changed during rendering; refresh before applying');
      for (const c of desired.citations) { text(c.text); if (c.anchor && !anchorFor(c)) fail('Citation anchor missing'); }
      const preparedTargets = {};
      if (documentType === 'text') {
        for (const c of [...desired.citations, ...(desired.bibliography ? [desired.bibliography] : [])]) {
          if (!c.anchor) { const range = writerRange(c.target || {}); if (intersectsManaged(range)) fail('The insertion target overlaps a managed citation'); preparedTargets[c.id] = range; }
        }
      }
      delete desired.nativeSnapshot;
      for (const old of state.citations) if (!desired.citations.some(c => c.id === old.id)) removeAnchor(old, false);
      const citations = [];
      for (const incoming of desired.citations) {
        const old = state.citations.find(c => c.id === incoming.id), citation = { ...incoming, anchor: old?.anchor };
        if (old && !anchorFor(old)) fail('Citation anchor was deleted; reconcile before refresh');
        citations.push(writeAnchor(citation, incoming.target, !!old, preparedTargets[citation.id])); delete citation.target; delete citation.runs;
      }
      let bibliography = null;
      if (desired.bibliography?.text !== undefined) {
        bibliography = { ...desired.bibliography, id: desired.bibliography.id || 'bibliography', anchor: state.bibliography?.anchor };
        writeAnchor(bibliography, desired.bibliography.target, !!state.bibliography?.anchor, preparedTargets[bibliography.id], state.bibliography);
        bibliography.copies = (state.bibliography?.copies || []).map(copy => writeAnchor({ ...bibliography, copies: undefined, anchor: copy.anchor }, null, true, null, copy));
        delete bibliography.target; delete bibliography.runs;
        for (const copy of bibliography.copies) { delete copy.target; delete copy.runs; }
      } else for (const old of bibliographies(state)) removeAnchor(old, false);
      persist({ ...desired, revision: state.revision, citations, bibliography });
      return inspectCitations();
    }
    if (operation === 'citations.unlink') {
      const state = metadata(); checkRevision(state);
      preflightCitationShapes(state);
      for (const citation of [...state.citations, ...bibliographies(state)]) removeAnchor(citation, true);
      persist(null); return { unlinked: true };
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
