// SPDX-License-Identifier: AGPL-3.0-or-later
// Exact Zotero 10.0.6 utilities_internal method; donor attribution in vendor.
module.exports = function(Zotero) { return ({getFileFromDocument: async function (doc) {
		let translate = new Zotero.Translate.Web();
		translate.setDocument(doc);
		var translators = await translate.getTranslators();
		// TEMP: Until there's a generic webpage translator
		if (!translators.length) {
			return false;
		}
		translate.setTranslator(translators[0]);
		var options = {
			libraryID: false,
			saveAttachments: true
		};
		let newItems = await translate.translate(options);
		if (!newItems.length) {
			return false;
		}
		for (let attachment of newItems[0].attachments) {
			if (Zotero.Attachments.FIND_AVAILABLE_FILE_TYPES.includes(attachment.mimeType)) {
				return {
					title: attachment.title,
					mimeType: attachment.mimeType,
					url: attachment.url
				};
			}
		}
		return false;
	}}).getFileFromDocument; };
