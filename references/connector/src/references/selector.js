/* Native Connector item-selector popup lifetime; AGPL-3.0-or-later. */
'use strict';
const referencesPopupPort = browser.runtime.connect({name:'references-selector'});
referencesPopupPort.onDisconnect.addListener(() => window.close());
