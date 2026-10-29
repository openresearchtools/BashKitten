/*
    ***** BEGIN LICENSE BLOCK *****
    
    Copyright © 2009 Center for History and New Media
                     George Mason University, Fairfax, Virginia, USA
                     http://zotero.org
    ItemSaver import filtering Copyright © 2011 Center for History and New Media
    
    This file is part of Zotero.
    
    Zotero is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    
    Zotero is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.
    
    You should have received a copy of the GNU Affero General Public License
    along with Zotero.  If not, see <http://www.gnu.org/licenses/>.
    
    ***** END LICENSE BLOCK *****
*/
// BashKitten 2026-10-28: only preserve fields discarded by the released
// object-only API converter. Copy/import filtering, field mapping/deduplication
// and Extra formatting come from pinned Zotero10.0.6; existing valid API fields
// retain their existing conversion. No DOI, publisher or content-specific rules.
module.exports = function(base) {
 const Zotero = Object.create(base);
 Zotero.ItemFields = Object.create(base.ItemFields);
 const byBase = new Map();
 // Native cachedTypes lacks this core accessor. Build its same base→type-field
 // cache from the already loaded pinned native schema, without a second schema.
 for (const id of Object.keys(base.ItemTypes.type).filter(id => /^\d+$/.test(id))) {
  for (const fieldID of base.ItemFields.getItemTypeFields(id)) {
   const baseID = base.ItemFields.getBaseIDFromTypeAndField(id, fieldID);
   if (!baseID) continue;
   if (!byBase.has(baseID)) byBase.set(baseID, new Set());
   byBase.get(baseID).add(base.ItemFields.getName(fieldID));
  }
 }
 // Core ItemFields marks only IDs present in baseFieldMappingsCombined as
 // base fields. The translation-only cachedTypes accessor predates this schema.
 Zotero.ItemFields.isBaseField = field => byBase.has(base.ItemFields.getID(field));
 Zotero.ItemFields.getBaseIDFromTypeAndField = function(type, field) {
  const id = this.getID(field);
  if (this.isBaseField(id) && (base.ItemFields.getFieldIDFromTypeAndBase(type, id)
      || base.ItemFields.isValidForType(id, type))) return id;
  return base.ItemFields.getBaseIDFromTypeAndField(type, field);
 };
 Zotero.ItemFields.getTypeFieldsFromBase = function(field, asNames) {
  const id = this.getID(field);
  if (!id) throw Error("Invalid base field '" + field + "' in ItemFields.getTypeFieldsFromBase()");
  const names = byBase.get(id);
  return names ? [...names].map(name => asNames ? name : this.getID(name)) : false;
 };
 const native = {
	_copyJSONItemForImport: function (item) {
		var newItem = Object.assign({}, item);
		const fieldsToDelete = [
			"attachments",
			"notes",
			"dateAdded",
			"dateModified",
			"seeAlso",
			"version",
			"id",
			"itemID",
			"path"
		];
		for (let field of fieldsToDelete) {
			delete newItem[field];
		}
		return newItem;
	},
	combineExtraFields: function (extra, fields) {
		var normalizedKeyMap = new Map();
		var normalizedFields = new Map();
		for (let [key, value] of fields) {
			let normalizedKey = this._normalizeExtraKey(key);
			normalizedFields.set(normalizedKey, value);
			normalizedKeyMap.set(normalizedKey, key);
		}
		var keepLines = [];
		var lines = extra !== '' ? extra.split(/\n/g) : [];
		for (let line of lines) {
			let parts = line.match(/^([a-z -_]+):(.+)/i);
			// Old citeproc.js cheater syntax;
			if (!parts) {
				parts = line.match(/^{:([a-z -_]+):(.+)}/i);
			}
			if (!parts) {
				keepLines.push(line);
				continue;
			}
			let [_, originalField, _value] = parts;
			
			let key = this._normalizeExtraKey(originalField);
			
			// If we have a new value for the field, update it
			if (normalizedFields.has(key)) {
				keepLines.push(originalField + ": " + normalizedFields.get(key));
				// Don't include with the other fields
				fields.delete(normalizedKeyMap.get(key));
			}
			else {
				keepLines.push(line);
			}
		}
		var fieldPairs = Array.from(fields.entries())
			.map(x => this.camelToTitleCase(x[0]) + ': ' + x[1]);
		fieldPairs.sort();
		return fieldPairs.join('\n')
			+ ((fieldPairs.length && keepLines.length) ? "\n" : "")
			+ keepLines.join("\n");
	},
	_normalizeExtraKey: function (key) {
		return key
			.trim()
			// Convert fooBar to foo-bar
			.replace(/([a-z])([A-Z])/g, '$1-$2')
			.toLowerCase()
			// Normalize to hyphens for spaces
			.replace(/[\s-_]/g, '-');
	},
	camelToTitleCase: function (str) {
		str = str.replace(/([a-z])([A-Z])/g, "$1 $2");
		return str.charAt(0).toUpperCase() + str.slice(1);
	},
 };
 Zotero.Utilities = {...base.Utilities, Internal:native};
 const handled = new Set(["key", "version", "itemType", "note", "md5", "mtime", "collections", "parentItem", "deleted", "inPublications", "extra", "accessDate", "dateAdded", "dateModified", "lastRead", "creators", "tags", "relations", "linkMode", "filename", "contentType", "charset", "path", "annotationType", "annotationAuthorName", "annotationText", "annotationComment", "annotationColor", "annotationPageLabel", "annotationSortIndex", "annotationPosition"]);
 return function preserveExtra(item, converted) {
  if (["attachment","note","annotation"].includes(converted.itemType)) return converted;
  const json = native._copyJSONItemForImport(item);
  const itemTypeID = Zotero.ItemTypes.getID(converted.itemType);
  const host = {
   itemTypeID, libraryKey:"References conversion",
   getField: field => converted[field] || "",
   setField(field, value) { if (field === "extra") converted.extra = value; }
  };
  (function() {
   var strict = false, isValidForType = {}, setFields = new Set();
   var extraFields = new Map(), extra = json.extra || "";
   var invalidFieldLogLines = new Map();
   for (let field in json) {
    if (handled.has(field)) continue;
    let val = json[field];
    switch (field) {
		default:
			let fieldID = Zotero.ItemFields.getID(field);
			if (!fieldID) {
				// In strict mode, fail on unknown field
				if (strict) {
					let e = new Error(`Unknown field '${field}'`);
					e.name = "ZoteroInvalidDataError";
					throw e;
				}
				// Otherwise store in Extra
				if (typeof val == 'string') {
					Zotero.warn(`Storing unknown field '${field}' in Extra for item ${this.libraryKey}`);
					extraFields.set(field, val);
					break;
				}
				Zotero.warn(`Discarding unknown JSON ${typeof val} '${field}' for item ${this.libraryKey}`);
				continue;
			}
			// Convert to base-mapped field if necessary, so that setFields has the base-mapped field
			// when it's checked for values from getUsedFields() below
			let origFieldID = fieldID;
			let origField = field;
			fieldID = Zotero.ItemFields.getFieldIDFromTypeAndBase(itemTypeID, fieldID) || fieldID;
			if (origFieldID != fieldID) {
				field = Zotero.ItemFields.getName(fieldID);
			}
			isValidForType[field] = Zotero.ItemFields.isValidForType(fieldID, this.itemTypeID);
			if (!isValidForType[field]) {
				let type = Zotero.ItemTypes.getName(itemTypeID);
				// In strict mode, fail on invalid field for type
				if (strict) {
					let e = new Error(`Invalid field '${origField}' for type ${type}`);
					e.name = "ZoteroInvalidDataError";
					throw e;
				}
				// Otherwise store in Extra
				extraFields.set(field, val);
				
				let msg = `Storing invalid field '${origField}' for type ${type} in Extra for `
					+ `item ${this.libraryKey}`;
				invalidFieldLogLines.set(field, msg);
				
				continue;
			}
			this.setField(field, json[origField]);
			setFields.add(field);
    }
   }
	// If one of the valid fields is a base field or a base-mapped field, remove all other
	// associated fields from Extra. This could be removed if we made sure that translators didn't
	// try to save multiple versions of base-mapped fields, which they shouldn't need to do.
	//
	// https://github.com/zotero/zotero/issues/1504#issuecomment-572415083
	if (!strict && extraFields.size) {
		for (let field of setFields.keys()) {
			let baseFieldID = Zotero.ItemFields.getBaseIDFromTypeAndField(itemTypeID, field);
			if (baseFieldID) {
				let mappedFieldNames = Zotero.ItemFields.getTypeFieldsFromBase(baseFieldID, true);
				for (let mappedField of mappedFieldNames) {
					if (extraFields.has(mappedField)) {
						extraFields.delete(mappedField);
						invalidFieldLogLines.delete(mappedField);
					}
				}
			}
		}
		
		//
		// Deduplicate remaining Extra fields
		//
		// For each invalid-for-type base field, remove any mapped fields with the same value
		let baseFields = [];
		for (let field of extraFields.keys()) {
			if (Zotero.ItemFields.getID(field) && Zotero.ItemFields.isBaseField(field)) {
				baseFields.push(field);
			}
		}
		for (let baseField of baseFields) {
			let value = extraFields.get(baseField);
			let mappedFieldNames = Zotero.ItemFields.getTypeFieldsFromBase(baseField, true);
			for (let mappedField of mappedFieldNames) {
				if (extraFields.has(mappedField) && extraFields.get(mappedField) === value) {
					extraFields.delete(mappedField);
					invalidFieldLogLines.delete(mappedField);
				}
			}
		}
		
		// Remove Type-mapped fields from Extra, since 'Type' is mapped to Item Type by citeproc-js
		// and Type values mostly aren't going to be useful for item types without a Type-mapped field.
		let typeFieldNames = Zotero.ItemFields.getTypeFieldsFromBase('type', true)
			// This is actually 'medium' but as of 2/2020 the Embedded Metadata translator
			// assigns it along with the other 'type' fields.
			.concat('audioFileType');
		for (let typeFieldName of typeFieldNames) {
			if (extraFields.has(typeFieldName)) {
				extraFields.delete(typeFieldName);
				invalidFieldLogLines.delete(typeFieldName);
			}
		}
		
		// Remove Extra lines created by double assignments in the RDF translator for fields that
		// aren't base-field mappings (which are deduped above). These should probably just become
		// base-field mappings, at which point this could be removed.
		var temporaryRDFFixes = [
			['versionNumber', 'edition'],
			
			['conferenceName', 'meetingName'],
			
			['publicationTitle', 'reporter'],
			['bookTitle', 'reporter'],
			['blogTitle', 'reporter'],
			['dictionaryTitle', 'reporter'],
			['encyclopediaTitle', 'reporter'],
			['forumTitle', 'reporter'],
			['proceedingsTitle', 'reporter'],
			['programTitle', 'reporter'],
			['websiteTitle', 'reporter'],
		];
		for (let x of temporaryRDFFixes) {
			if (extraFields.has(x[0]) && setFields.has(x[1])
					&& extraFields.get(x[0]) == this.getField(x[1])) {
				extraFields.delete(x[0]);
				invalidFieldLogLines.delete(x[0]);
			}
			if (extraFields.has(x[1]) && setFields.has(x[0])
					&& extraFields.get(x[1]) == this.getField(x[0])) {
				extraFields.delete(x[1]);
				invalidFieldLogLines.delete(x[1]);
			}
		}
	}
	
	for (let line of invalidFieldLogLines.values()) {
		Zotero.warn(line);
	}
	
	if (extra || extraFields.size || this.getField('extra')) {
		this.setField('extra', Zotero.Utilities.Internal.combineExtraFields(extra, extraFields));
	}
	
  }).call(host);
  return converted;
 };
};
