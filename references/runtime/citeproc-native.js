// SPDX-License-Identifier: AGPL-3.0-or-later
// Use the pinned Zotero processor and Style methods unchanged. Only desktop
// style lookup and the current document's item/locale access need Node hosts.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '../vendor/zotero/source/chrome/content/zotero/xpcom');
const processorFile = path.join(root, 'citeproc.js');
const CSL = new vm.Script('(function () {\n' + fs.readFileSync(processorFile, 'utf8') + '\nreturn CSL;\n})()', {
  filename: processorFile,
}).runInThisContext();
const styleFile = path.join(root, 'style.js');
const styleSource = fs.readFileSync(styleFile, 'utf8');
const { DOMParser, XMLSerializer } = new JSDOM('').window;

function nativeMethod(name) {
  const marker = 'Zotero.Style.prototype.' + name + ' = ';
  const start = styleSource.indexOf(marker);
  const end = styleSource.indexOf('\n};', start);
  if (start < 0 || end < 0) throw Error('Pinned Zotero Style method is unavailable: ' + name);
  return new vm.Script('(' + styleSource.slice(start + marker.length, end + 2) + ')', {
    filename: styleFile + ':' + name,
  });
}
const getCiteProc = nativeMethod('getCiteProc');
const eventToEventTitle = nativeMethod('_eventToEventTitle');

module.exports = {
  CSL,
  createProcessor(Cite, { style, locale, format, retrieveItem, retrieveLocale }) {
    const styles = new Map();
    const Zotero = {
      locale,
      Prefs: { get: () => false },
      debug() {},
      logError() {},
      CiteProc: { CSL },
      Styles: { get: id => styles.get(id) },
      Cite: {
        System: function (options) {
          const system = new Cite.System(options);
          Object.assign(system, { retrieveItem, retrieveLocale });
          return system;
        },
      },
    };
    const context = vm.createContext({ Zotero, DOMParser, XMLSerializer });
    const renameEvent = eventToEventTitle.runInContext(context);
    function nativeStyle(record) {
      const selected = {
        ...record.native,
        getXML: () => record.xml,
        _eventToEventTitle: renameEvent,
      };
      styles.set(selected.styleID, selected);
      if (record.parent) styles.set(selected.source, nativeStyle(record.parent));
      return selected;
    }
    return getCiteProc.runInContext(context).call(nativeStyle(style), locale, format);
  },
};
