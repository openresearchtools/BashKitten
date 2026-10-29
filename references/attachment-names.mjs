// SPDX-License-Identifier: AGPL-3.0-or-later
// Pinned Zotero naming/template methods own creator/year/title formatting.
// This adapter supplies the Item interfaces missing across our JSON boundary.
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const nativeNaming = require('./runtime/attachment-filename-native.js');
const templates = require('./runtime/filename-templates.js');
const schema = require('./vendor/schema/source/schema.json');
const fields = [...new Set(schema.itemTypes.flatMap(type => type.fields.flatMap(({ field, baseField }) => baseField ? [field, baseField] : [field])))];
// Exact DEFAULT_ATTACHMENT_RENAME_TEMPLATE from the pinned renameFiles.mjs.
export const attachmentRenameTemplate = '{{ firstCreator suffix=" - " }}{{ year suffix=" - " }}{{ title truncate="100" }}';
const names = new WeakMap();
const fileMethods = nativeNaming({ Utilities: { Internal: { byteLength: value => Buffer.byteLength(String(value), 'utf8') } } }, templates);
export const truncateFilename = (value, maxBytes) => fileMethods.truncateFileName(value, maxBytes);
export const validFilename = value => fileMethods.getValidFileName(String(value));

// The native filename template formats the stem; retain the local upload's
// actual extension across the JSON boundary where no nsIMIMEService exists.
export function attachmentExtension({ filename, contentType } = {}) {
  if (typeof filename === 'string') {
    const name = validFilename(filename.replaceAll('\\', '/').split('/').at(-1));
    const extension = path.extname(name);
    if (extension && extension !== '.') return extension;
  }
  return {
    'application/pdf': '.pdf',
    'text/html': '.html',
    'application/epub+zip': '.epub',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/msword': '.doc',
    'application/xml': '.xml',
    'text/xml': '.xml',
    'text/plain': '.txt',
    'application/rtf': '.rtf',
    'application/vnd.oasis.opendocument.text': '.odt',
  }[String(contentType || '').split(';', 1)[0].trim().toLowerCase()] || '';
}

export function createNativeAttachmentNamer(base) {
  if (names.has(base)) return names.get(base);
  let native;
  class Item {
    constructor(data) {
      this.data = data;
      this.libraryID = 1;
      this.itemType = data.itemType || 'document';
      this.itemTypeID = base.ItemTypes.getID(this.itemType);
    }
    getCreators() {
      return (this.data.creators || []).map(creator => ({
        ...creator,
        lastName: creator.name || creator.lastName || creator.firstName || '',
        firstName: creator.firstName || '',
        creatorTypeID: creator.creatorTypeID || base.CreatorTypes.getID(creator.creatorType || 'author'),
      }));
    }
    getField(field) {
      if (field === 'firstCreator') return native.getFirstCreatorFromData(this.itemTypeID, this.getCreators(), { omitBidiIsolates: true });
      if (field === 'date') return this.data.date ? base.Date.strToMultipart(this.data.date) : '';
      return this.data[field] || '';
    }
  }
  const Z = {
    ...base,
    Item,
    ItemFields: Object.assign(Object.create(base.ItemFields), { getAll: () => fields.map(name => ({ name })) }),
    File: fileMethods,
    // Exact pinned en-US strings used by the native firstCreator method.
    getString: (key, args) => key === 'general.andJoiner' ? '%S and %S'.replace('%S', args[0]).replace('%S', args[1]) : key === 'general.etAl' ? 'et al.' : key,
  };
  native = nativeNaming(Z, templates);
  const format = (data = {}, { attachmentTitle = '' } = {}) => {
    const item = new Item(data);
    const name = native.getFileBaseNameFromItem(item, { formatString: attachmentRenameTemplate, attachmentTitle });
    return name && name !== '_' ? name : validFilename(attachmentTitle || 'attachment');
  };
  names.set(base, format);
  return format;
}
