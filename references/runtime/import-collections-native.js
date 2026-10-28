/*
    ***** BEGIN LICENSE BLOCK *****
    
    Copyright © 2011 Center for History and New Media
                     George Mason University, Fairfax, Virginia, USA
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

// BashKitten 2026-10-28: native collection hierarchy mapper; persistence is injected.
module.exports = Zotero => {
return async function (collections) {
		var collectionsToProcess = collections.slice();
		// Use first collection passed to translate process as the root
		var rootCollectionID = (this._collections && this._collections.length)
			? this._collections[0] : null;
		var parentIDs = collections.map(c => null);
		var topLevelCollections = [];

		await Zotero.DB.executeTransaction(async function () {
			while(collectionsToProcess.length) {
				var collection = collectionsToProcess.shift();
				var parentID = parentIDs.shift();

				var newCollection = new Zotero.Collection;
				newCollection.libraryID = this._libraryID;
				newCollection.name = collection.name;
				if (parentID) {
					newCollection.parentID = parentID;
				}
				else {
					newCollection.parentID = rootCollectionID;
					topLevelCollections.push(newCollection)
				}
				await newCollection.save(this._saveOptions);

				var toAdd = [];

				for(var i=0; i<collection.children.length; i++) {
					var child = collection.children[i];
					if(child.type === "collection") {
						// do recursive processing of collections
						collectionsToProcess.push(child);
						parentIDs.push(newCollection.id);
					} else {
						// add mapped items to collection
						if(this._IDMap[child.id]) {
							toAdd.push(this._IDMap[child.id]);
						} else {
							Zotero.debug("Translate: Could not map "+child.id+" to an imported item", 2);
						}
					}
				}

				if(toAdd.length) {
					Zotero.debug("Translate: Adding " + toAdd, 5);
					await newCollection.addItems(toAdd);
				}
			}
		}.bind(this));

		return topLevelCollections;
	};
};
