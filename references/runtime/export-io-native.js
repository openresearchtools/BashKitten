/*
    ***** BEGIN LICENSE BLOCK *****
    
    Copyright © 2012 Center for History and New Media
                     George Mason University, Fairfax, Virginia, USA
                     http://zotero.org
    
    This file is part of Zotero.
    
    Portions of this file are derived from Special Powers code,
    Copyright (C) 2010 Mozilla Corporation. All Rights Reserved.
    
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

// Extracted unchanged from pinned Zotero translate_firefox.js Write support.
// Node supplies the two XPCOM stream interfaces; see ../native-export.mjs.
module.exports = function installNativeExportIO(Zotero, Components) {
const BOMs = {
	"UTF-8":"\xEF\xBB\xBF",
	"UTF-16BE":"\xFE\xFF",
	"UTF-16LE":"\xFF\xFE",
	"UTF-32BE":"\x00\x00\xFE\xFF",
	"UTF-32LE":"\xFF\xFE\x00\x00"
}

Zotero.Translate.IO.Write = function (file) {
	Zotero.Translate.IO.maintainedInstances.push(this);
	this._rawStream = Components.classes["@mozilla.org/network/file-output-stream;1"]
		.createInstance(Components.interfaces.nsIFileOutputStream);
	this._rawStream.init(file, 0x02 | 0x08 | 0x20, 0o664, 0); // write, create, truncate
	this._writtenToStream = false;
}

Zotero.Translate.IO.Write.prototype = {
	"__exposedProps__":{
		"RDF":"r",
		"write":"r",
		"setCharacterSet":"r"
	},
	
	"_initRDF":function () {
		Zotero.debug("Translate: Initializing RDF data store");
		this._dataStore = new Zotero.RDF.AJAW.IndexedFormula();
		this.RDF = new Zotero.Translate.IO._RDFSandbox(this._dataStore);
	},
	
	"setCharacterSet":function (charset) {
		if(typeof charset !== "string") {
			throw new Error("Translate: setCharacterSet: charset must be a string");
		}
		
		if(!this.outputStream) {
			this.outputStream = Components.classes["@mozilla.org/intl/converter-output-stream;1"]
								   .createInstance(Components.interfaces.nsIConverterOutputStream);
		}
		
		if(charset == "UTF-8xBOM") charset = "UTF-8";
		this.outputStream.init(this._rawStream, charset, 1024, "?".charCodeAt(0));
		this._charset = charset;
	},
	
	/**
	 * Set a function to modify data on each write()
	 */
	setDataProcessor: function (processor) {
		this._processor = processor;
	},
	
	"write":function (data) {
		if(!this._charset) this.setCharacterSet("UTF-8");
		
		if (this._processor) {
			data = this._processor(data);
		}
		
		if(!this._writtenToStream && this._charset.substr(this._charset.length-4) == "xBOM"
		   && BOMs[this._charset.substr(0, this._charset.length-4).toUpperCase()]) {
			// If stream has not yet been written to, and a UTF type has been selected, write BOM
			this._rawStream.write(BOMs[streamCharset], BOMs[streamCharset].length);
		}
		
		if(this._charset == "MACINTOSH") {
			// fix buggy Mozilla MacRoman
			var splitData = data.split(/([\r\n]+)/);
			for(var i=0; i<splitData.length; i+=2) {
				// write raw newlines straight to the string
				this.outputStream.writeString(splitData[i]);
				if(splitData[i+1]) {
					this._rawStream.write(splitData[i+1], splitData[i+1].length);
				}
			}
		} else {
			this.outputStream.writeString(data);
		}
		
		this._writtenToStream = true;
	},
	
	init: function (newMode, charset) {
		this._mode = newMode;
		if(Zotero.Translate.IO.rdfDataModes.indexOf(this._mode) !== -1) {
			this._initRDF();
			if(!this._writtenToString) this.setCharacterSet("UTF-8");
		} else if(!this._writtenToString) {
			this.setCharacterSet(charset ? charset : "UTF-8");
		}
	},
	
	"close":function () {
		if(Zotero.Translate.IO.rdfDataModes.indexOf(this._mode) !== -1) {
			this.write(this.RDF.serialize());
		}
		
		var myIndex = Zotero.Translate.IO.maintainedInstances.indexOf(this);
		if(myIndex !== -1) Zotero.Translate.IO.maintainedInstances.splice(myIndex, 1);
		
		this._rawStream.close();
	}
}

return Zotero.Translate.IO.Write;
};
