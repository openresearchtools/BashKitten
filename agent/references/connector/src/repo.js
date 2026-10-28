/* References pinned translator data adapter. AGPL-3.0-or-later. */
Zotero.Repo = new function () {
  this.infoRe = /^\s*{[\S\s]*?}\s*?[\r\n]/;
  this.getTranslatorCode = async function (id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid translator identity');
    const response = await fetch(browser.runtime.getURL(`translators/${id}.js`));
    if (!response.ok) throw new Error('Pinned translator unavailable');
    return response.text();
  };
  this.getTranslatorMetadataFromZotero = async function () {
    const response = await fetch(browser.runtime.getURL('translators/metadata.json'));
    if (!response.ok) throw new Error('Pinned translator metadata unavailable');
    return response.json();
  };
  this.getTranslatorMetadataFromServer = this.getTranslatorMetadataFromZotero;
};
