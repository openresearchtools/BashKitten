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

// BashKitten 2026-10-28: native Zotero 10.0.6 header decoder, independent of server transport.
const Zotero = { debug() {} };
export const decodeRFC2047 = function (value) {
	// RFC 2047-decode the result.
	// Process encoded words anywhere in the header value, as per RFC 2047 section 5
	// which allows ordinary ASCII text and encoded words to appear together.
	
	// Helper function to convert string to bytes
	function stringToBytes(str) {
		if (typeof str !== "string") {
			throw new Error("Invalid argument for stringToBytes");
		}
		const length = str.length;
		const bytes = new Uint8Array(length);
		for (let i = 0; i < length; ++i) {
			bytes[i] = str.charCodeAt(i) & 0xff;
		}
		return bytes;
	}
	
	// Helper function to decode text with specified encoding
	function textDecode(encoding, value) {
		if (encoding) {
			if (!/^[\x00-\xFF]+$/.test(value)) {
				return value;
			}
			try {
				const decoder = new TextDecoder(encoding, { fatal: true });
				const buffer = stringToBytes(value);
				value = decoder.decode(buffer);
			}
			// TextDecoder constructor threw - unrecognized encoding.
			catch {
				Zotero.debug(`decodeRFC2047: Unrecognized encoding: ${encoding}`, 1);
			}
		}
		return value;
	}
	
	// RFC 2047, section 2.4
	// encoded-word = "=?" charset "?" encoding "?" encoded-text "?="
	// charset = token (but let's restrict to characters that denote a
	//       possibly valid encoding).
	// encoding = q or b
	// encoded-text = any printable ASCII character other than ? or space.
	return value.replace(
		/=\?([\w-]+)\?([QqBb])\?((?:[^? ]|\?(?!=))*)\?=/g,
		(matches, charset, encoding, text) => {
			if (encoding === "q" || encoding === "Q") {
				// RFC 2047 section 4.2.
				text = text.replace(/_/g, " ");
				text = text.replace(/=([0-9a-fA-F]{2})/g, (match, hex) => {
					return String.fromCharCode(parseInt(hex, 16));
				});
				return textDecode(charset, text);
			}
			// else encoding is b or B - base64 (RFC 2047 section 4.1)
			try {
				text = atob(text);
			}
			catch {
				Zotero.debug(`decodeRFC2047: Invalid base64: ${text}`, 1);
			}
			return textDecode(charset, text);
		}
	);
};
