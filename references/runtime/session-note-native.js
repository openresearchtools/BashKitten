// SPDX-License-Identifier: AGPL-3.0-or-later
/*
	***** BEGIN LICENSE BLOCK *****
	
	Copyright © 2024 Corporation for Digital Scholarship
					Vienna, Virginia, USA
					http://zotero.org
	
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
// Exact pinned SaveSession._updateNote; native item/storage host is injected.
module.exports = Zotero => async function (item) {
		// If a note is passed, add it as a child item
		if (this._currentNote) {
			// If the note item already exists, update it. Otherwise, create a new one.
			let existingItemNoteID = this._userAddedNotes[item.id];
			let noteItem = existingItemNoteID && Zotero.Items.get(existingItemNoteID);
			if (!noteItem) {
				noteItem = new Zotero.Item('note');
			}
			noteItem.setNote(this._currentNote);
			noteItem.parentID = item.id;
			noteItem.libraryID = item.libraryID;
			await noteItem.saveTx();
			// Record which of the notes is added by the user to this item
			this._userAddedNotes[item.id] = noteItem.id;
		}
		// If the note was typed and then erased, delete it
		else if (this._userAddedNotes[item.id]) {
			let noteItem = Zotero.Items.get(this._userAddedNotes[item.id]);
			if (noteItem) {
				await noteItem.eraseTx();
			}
			delete this._userAddedNotes[item.id];
		}
};
