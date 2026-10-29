/*
 ***** BEGIN LICENSE BLOCK *****
 
 Copyright © 2009 Center for History and New Media
 George Mason University, Fairfax, Virginia, USA
 http://zotero.org
 
 This file is part of Zotero.
 
 Zotero is free software: you can redistribute it and/or modify
 it under the terms of the GNU Affero General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.
 
 Zotero is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 GNU Affero General Public License for more details.
 
 You should have received a copy of the GNU Affero General Public License
 along with Zotero. If not, see <http://www.gnu.org/licenses/>.
 
 ***** END LICENSE BLOCK *****
*/
// BashKitten adaptation: exact pinned native naming methods with JSON item, template and filesystem interfaces injected.
module.exports = function(Zotero, lazy) {
 const native = {};
	native.normalizeRenameTemplate = function (formatString) {
		return formatString.replace(/\r?\n|\r/g, "").trim();
	};

	native.getFileBaseNameFromItem = function (item, options = {}) {
		if (!(item instanceof Zotero.Item)) {
			throw new Error("'item' must be a Zotero.Item");
		}
		if (!item.libraryID) {
			throw new Error("Item must have a libraryID");
		}
		if (typeof options === 'string') {
			Zotero.warn("Zotero.Attachments.getFileBaseNameFromItem(item, formatString) is deprecated -- use Zotero.Attachments.getFileBaseNameFromItem(item, options)");
			options = { formatString: options };
		}

		let { formatString = null, attachmentTitle = '' } = options;
		if (!formatString) {
			formatString = this.getAttachmentRenameTemplate(item.libraryID);
		}

		let chunks = [];
		let protectedLiterals = new Set();

		formatString = this.normalizeRenameTemplate(formatString);

		const getSlicedCreatorsOfType = (creatorType, slice) => {
			let creatorTypeIDs;
			switch (creatorType) {
				case 'authors':
					creatorTypeIDs = [Zotero.CreatorTypes.getPrimaryIDForType(item.itemTypeID)];
					break;
				case 'editors':
					creatorTypeIDs = [Zotero.CreatorTypes.getID('editor'), Zotero.CreatorTypes.getID('seriesEditor')];
					break;
				default:
				case 'creators':
					creatorTypeIDs = null;
					break;
			}
			
			if (slice === 0) {
				return [];
			}
			const matchingCreators = creatorTypeIDs === null
				? item.getCreators()
				: item.getCreators().filter(c => creatorTypeIDs.includes(c.creatorTypeID));
			const slicedCreators = slice > 0
				? matchingCreators.slice(0, slice)
				: matchingCreators.slice(slice);

			if (slice < 0) {
				slicedCreators.reverse();
			}
			return slicedCreators;
		};


		const common = (value, { start = false, truncate = false, prefix = '', suffix = '', match = '', replaceFrom = '', replaceTo = '', regexOpts = 'vi', case: textCase = '' } = {}) => {
			if (value === '' || value === null || typeof value === 'undefined') {
				return '';
			}

			if (prefix === '\\' || prefix === '/') {
				prefix = '';
			}

			if (suffix === '\\' || suffix === '/') {
				suffix = '';
			}

			// match overrides all other options and returns immediately
			if (match) {
				try {
					let matchResult = value.match(new RegExp(match, regexOpts));
					return matchResult ? matchResult[0] : '';
				}
				catch (_e) {
					return '';
				}
			}

			if (protectedLiterals.size > 0) {
				// escape protected literals in the format string with \
				value = value.replace(
					new RegExp(`(${Array.from(protectedLiterals.keys()).join('|')})`, 'g'),
					'\\$1//'
				);
			}

			if (start) {
				value = value.substring(start);
			}

			if (truncate) {
				value = value.substring(0, truncate);
			}

			value = value.trim();
			let rawValue = value;

			let affixed = false;

			if (replaceFrom) {
				try {
					value = value.replace(new RegExp(replaceFrom, regexOpts), replaceTo);
				}
				catch (_e) {
					// ignore
				}
			}
			if (prefix && !value.startsWith(prefix)) {
				value = prefix + value;
				affixed = true;
			}
			if (suffix && !value.endsWith(suffix)) {
				value += suffix;
				affixed = true;
			}

			if (affixed) {
				chunks.push({ value, rawValue, suffix, prefix });
			}

			switch (textCase) {
				case 'upper':
					value = value.toUpperCase();
					break;
				case 'lower':
					value = value.toLowerCase();
					break;
				case 'sentence':
					value = value.slice(0, 1).toUpperCase() + value.slice(1);
					break;
				case 'title':
					value = Zotero.Utilities.capitalizeTitle(value, true);
					break;
				case 'hyphen':
					value = value.replace(/\s+-/g, '-').replace(/-\s+/g, '-');
					value = value.toLowerCase().replace(/\s+/g, '-');
					break;
				case 'snake':
					value = value.replace(/\s+_/g, '_').replace(/_\s+/g, '_');
					value = value.toLowerCase().replace(/\s+/g, '_');
					break;
				case 'camel':
					value = value.toLowerCase().replace(/[^\p{L}\d]+(.)/gu, (m, chr) => chr.toUpperCase());
					break;
				case 'pascal':
					value = value.toLowerCase().replace(/[^\p{L}\d]+(.)/gu, (m, chr) => chr.toUpperCase());
					value = value.slice(0, 1).toUpperCase() + value.slice(1);
					break;
			}
			return value;
		};

		const initializeFn = (name, shouldInitialize, initializeWith) => (shouldInitialize ? name.slice(0, 1).toUpperCase() + initializeWith : name);

		const transformName = (creator, { name, namePartSeparator, initialize, initializeWith } = {}) => {
			if (creator.name) {
				return initializeFn(creator.name, ['full', 'name'].includes(initialize), initializeWith);
			}

			const firstLast = ['full', 'given-family', 'first-last'];
			const lastFirst = ['full-reversed', 'family-given', 'last-first'];
			const first = ['given', 'first'];
			const last = ['family', 'last'];

			if (firstLast.includes(name)) {
				return initializeFn(creator.firstName, ['full', ...first].includes(initialize), initializeWith) + namePartSeparator + initializeFn(creator.lastName, ['full', ...last].includes(initialize), initializeWith);
			}
			else if (lastFirst.includes(name)) {
				return initializeFn(creator.lastName, ['full', ...last].includes(initialize), initializeWith) + namePartSeparator + initializeFn(creator.firstName, ['full', ...first].includes(initialize), initializeWith);
			}
			else if (first.includes(name)) {
				return initializeFn(creator.firstName, ['full', ...first].includes(initialize), initializeWith);
			}

			return initializeFn(creator.lastName, ['full', ...last].includes(initialize), initializeWith);
		};

		const commonCreators = (value, { max = Infinity, name = 'family', namePartSeparator = ' ', join = ', ', initialize = '', initializeWith = '.' } = {}) => {
			return getSlicedCreatorsOfType(value, max)
				.map(c => transformName(c, { name, namePartSeparator, initialize, initializeWith }))
				.join(join);
		};

		const fields = Zotero.ItemFields.getAll()
			.map(f => f.name)
			.filter(f => f !== 'accessDate')
			.reduce((obj, name) => {
				obj[name] = (args) => {
					return common(item.getField(name, false, true), args);
				};
				return obj;
			}, {});

		const year = (args) => {
			let value = item.getField('date', true, true);
			if (value) {
				value = Zotero.Date.multipartToSQL(value).substr(0, 4);
				if (value == '0000') {
					value = '';
				}
			}
			return common(value, args);
		};

		const itemType = ({ localize = false, ...rest }) => common(
			localize ? Zotero.ItemTypes.getLocalizedString(item.itemType) : item.itemType, rest
		);

		const creatorFields = ['authors', 'editors', 'creators'].reduce((obj, name) => {
			obj[name] = (args) => {
				return common(commonCreators(name, args), args);
			};
			obj[`${name}Count`] = (args) => {
				return common(getSlicedCreatorsOfType(name, Infinity).length.toString(), args);
			};
			return obj;
		}, {});

		const firstCreator = args => common(
			// Pass unformatted = true to omit bidi isolates
			item.getField('firstCreator', true, true), args
		);

		const attachmentTitleFn = args => common(attachmentTitle ?? '', args);
		
		const accessDate = ({ timeZone = null, ...rest }) => {
			let value = item.getField('accessDate', true, true);
			if (!timeZone) {
				return common(value, rest);
			}
			try {
				// Append "Z" to explicitly mark this as a UTC date for Temporal
				let instant = Temporal.Instant.from(`${value}Z`); // eslint-disable-line no-undef
				let zdt = instant.toZonedDateTimeISO(timeZone);

				// Remove "T" from the ISO string to match the output of `item.getField('accessDate')`
				let stringDate = zdt.toPlainDateTime().toString({ fractionalSecondDigits: 0 }).replace('T', ' ');
				return common(stringDate, rest);
			}
			catch (e) {
				Zotero.warn(`Error converting date "${value}" to timezone "${timeZone}" for ${item.key}: ${e}`);
				return common(value, rest);
			}
		};

		const vars = { ...fields, ...creatorFields, attachmentTitle: attachmentTitleFn, firstCreator, itemType, year, accessDate };

		// Final name is generated twice. In the first pass we collect all affixed values and determine protected literals.
		// This is done in order to remove repeated suffixes, except if these appear in the value or the format string itself.
		// See "should suppress suffixes where they would create a repeat character" test for edge cases.
		let formatted = lazy.generateHTMLFromTemplate(formatString, vars);
		
		let replacePairs = new Map();
		for (let chunk of chunks) {
			if (chunk.suffix && formatted.includes(`${chunk.rawValue}${chunk.suffix}${chunk.suffix}`)) {
				protectedLiterals.add(`${chunk.rawValue}${chunk.suffix}${chunk.suffix}`);
				replacePairs.set(`${chunk.rawValue}${chunk.suffix}${chunk.suffix}`, `${chunk.rawValue}${chunk.suffix}`);
			}
			if (chunk.prefix && formatted.includes(`${chunk.prefix}${chunk.prefix}${chunk.rawValue}`)) {
				protectedLiterals.add(`${chunk.prefix}${chunk.prefix}${chunk.rawValue}`);
				replacePairs.set(`${chunk.prefix}${chunk.prefix}${chunk.rawValue}`, `${chunk.prefix}${chunk.rawValue}`);
			}
		}

		// Use "/" and "\" as escape characters for protected literals. We need two different escape chars for edge cases.
		// Both escape chars are invalid in file names and thus removed from the final string by `getValidFileName`
		if (protectedLiterals.size > 0) {
			formatString = formatString.replace(
				new RegExp(`(${Array.from(protectedLiterals.keys()).join('|')})`, 'g'),
				'\\$1//'
			);
		}

		formatted = lazy.generateHTMLFromTemplate(formatString, vars);
		if (replacePairs.size > 0) {
			formatted = formatted.replace(
				new RegExp(`(${Array.from(replacePairs.keys()).map(replace => `(?<!\\\\)${replace}(?!//)`).join('|')})`, 'g'),
				match => replacePairs.get(match)
			);
		}
		
		formatted = Zotero.Utilities.cleanTags(formatted);
		formatted = Zotero.File.getValidFileName(formatted);
		return formatted;
	};

	native.getFirstCreatorFromData = function (itemTypeID, creatorsData, options) {
		if (!options) {
			options = {
				omitBidiIsolates: false
			};
		}
		
		if (creatorsData.length === 0) {
			return "";
		}
		
		var validCreatorTypes = [
			Zotero.CreatorTypes.getPrimaryIDForType(itemTypeID),
			Zotero.CreatorTypes.getID('editor'),
			// Director used to be the primary type for Video Recording before
			// Creator (mapped to Author) was added
			Zotero.CreatorTypes.getID('director'),
			Zotero.CreatorTypes.getID('contributor')
		];
	
		for (let creatorTypeID of validCreatorTypes) {
			let matches = creatorsData.filter(data => data.creatorTypeID == creatorTypeID)
			if (!matches.length) {
				continue;
			}
			if (matches.length === 1) {
				return matches[0].lastName;
			}
			if (matches.length === 2) {
				let a = matches[0];
				let b = matches[1];
				let args = options.omitBidiIsolates
					? [a.lastName, b.lastName]
					// \u2068 FIRST STRONG ISOLATE: Isolates the directionality of characters that follow
					// \u2069 POP DIRECTIONAL ISOLATE: Pops the above isolation
					: [`\u2068${a.lastName}\u2069`, `\u2068${b.lastName}\u2069`];
				return Zotero.getString('general.andJoiner', args);
			}
			if (matches.length >= 3) {
				return matches[0].lastName + " " + Zotero.getString('general.etAl');
			}
		}
		
		return "";
	};
	
	
	function getValidFileName(fileName, skipXML) {
		// TODO: use space instead, and figure out what's doing extra
		// URL encode when saving attachments that trigger this
		fileName = fileName.replace(/[\/\\\?\*:|"<>]/g, '');
		// Replace newlines and tabs (which shouldn't be in the string in the first place) with spaces
		fileName = fileName.replace(/[\r\n\t]+/g, ' ');
		// Replace various thin spaces
		fileName = fileName.replace(/[\u2000-\u200A]/g, ' ');
		// Replace zero-width spaces
		fileName = fileName.replace(/[\u200B-\u200E]/g, '');
		// Replace line and paragraph separators
		fileName = fileName.replace(/[\u2028-\u2029]/g, ' ');
		if (!skipXML) {
			// Strip characters not valid in XML, since they won't sync and they're probably unwanted
			fileName = fileName.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/g, '');
			
			// Normalize to NFC
			fileName = fileName.normalize();
		}
		// Replace bidi isolation control characters
		fileName = fileName.replace(/[\u2068\u2069]/g, '');
		// Don't allow hidden files
		fileName = fileName.replace(/^\./, '');
		// Don't allow blank or illegal filenames
		if (!fileName || fileName == '.' || fileName == '..') {
			fileName = '_';
		}
		return fileName;
	}
	
	function truncateFileName(fileName, maxLength) {
		if (!fileName || Zotero.Utilities.Internal.byteLength((fileName + '')).length <= maxLength) {
			return fileName;
		}

		var parts = (fileName + '').split(/\.(?=[^.]+$)/);
		var name = parts[0];
		var ext = parts[1];
		//if the file starts with a period , use the whole file
		//the whole file name might also just be a period
		if (!name) {
			name = '.' + (ext || '');
		}

		//treat long extensions as part of the file name
		if (ext && ext.length > 20) {
			name += '.' + ext;
			ext = undefined;
		}
		
		// No period in the whole filename
		if (ext === undefined) {
			ext = '';
		}
		else {
			ext = '.' + ext;
		}

		// Drop extension if it wouldn't fit within the limit
		// E.g., for (lorem.json, 5), return "lorem" instead of ".json"
		if (Zotero.Utilities.Internal.byteLength(ext) >= maxLength) {
			ext = '';
		}
		
		while (Zotero.Utilities.Internal.byteLength(name + ext) > maxLength) {
			// Split into characters, so we don't corrupt emoji characters (though we might
			// change multi-part emoji in unfortunate ways by removing some of the characters)
			let parts = [...name];
			name = name.substring(0, name.length - parts[parts.length - 1].length);
		}
		
		// If removed completely, use underscore
		if (name == '') {
			name = '_';
		}
		
		return name + ext;
	}
	

 native.getValidFileName = getValidFileName; native.truncateFileName = truncateFileName;
 return native;
};
