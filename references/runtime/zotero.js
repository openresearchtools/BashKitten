// SPDX-License-Identifier: AGPL-3.0-or-later
// Adapted 2026-10-28 from translation-server/src/zotero.js (see vendor source.json).
// Native translation interfaces with only Node module paths, private preferences and no logs.
const path=require('node:path');
const root=path.resolve(__dirname,'../vendor');
class URIError extends Error { constructor(message){super(message);this.result='NS_ERROR_MALFORMED_URI';} }
global.Components={Exception:URIError,results:{NS_ERROR_MALFORMED_URI:'NS_ERROR_MALFORMED_URI'},interfaces:{}};
global.Services={io:{newURI(value,_charset,base){try{const url=new URL(value,base?.spec);return {spec:url.href,host:url.hostname,resolve:relative=>new URL(relative,url).href};}catch(error){throw new URIError(error.message);}}}};
const prefs=new Map([['translatorsDirectory',path.join(root,'translators/source')]]);
const Zotero=global.Zotero=module.exports={isNode:true,isServer:true,isFx:false,isElectron:false,locale:'en-US',version:'10.0.6',debug(){},logError(){},warn(){},setTimeout,
 Prefs:{get:key=>prefs.get(key),set:(key,value)=>prefs.set(key,value),clear:key=>prefs.delete(key)},
 requireTranslate:p=>require(path.resolve(root,'translate/source/src',p)),
 requireUtilities:p=>require(path.resolve(root,'utilities/source',p))};
Zotero.Promise=Zotero.requireTranslate('./promise');
Zotero.Debug={log(){}};
Zotero.Translators=require('./translators');
Zotero.Utilities=require('./utilities');
Zotero.Date=Zotero.requireUtilities('./date');
Zotero.Date.init(Zotero.requireUtilities('./resource/dateFormats.json'));
Zotero.OpenURL=Zotero.requireUtilities('./openurl');
Zotero.Translator=Zotero.requireTranslate('./translator');
Zotero.Translate=require('./translation/translate');
Zotero.Proxies=require('./proxy').Proxies;
Zotero.Proxy=require('./proxy').Proxy;
Zotero.RDF={AJAW:Zotero.requireTranslate('./rdf/init')};
Object.assign(Zotero,Zotero.requireUtilities('./cachedTypes'));
Zotero.setTypeSchema(Zotero.requireUtilities('./resource/zoteroTypeSchemaData'));
Zotero.HTTP=require('./http');
