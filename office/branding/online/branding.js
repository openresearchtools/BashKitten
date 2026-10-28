// SPDX-License-Identifier: AGPL-3.0-only
// Loaded by the pinned Online native branding hook, before its deferred bundle.
(function () {
	'use strict';
	const script = document.currentScript;
	if (!script || !script.src) return;
	const base = new URL('.', script.src);
	const asset = name => new URL(name, base).href;

	window.brandProductName = 'Office';
	window.brandProductURL = 'https://github.com/openresearchtools/BashKitten';
	// Native loading and document-header code already consume this setting. Keep
	// the native create-document action; do not install another logo click owner.
	window.logoURL = asset('images/office.svg');
	if (document.title === 'Online Editor' || document.title === 'Collabora Online') {
		document.title = 'Office';
	}

	let favicon = document.querySelector('link[rel="icon"]');
	if (!favicon) {
		favicon = document.createElement('link');
		favicon.rel = 'icon';
		document.head.appendChild(favicon);
	}
	favicon.type = 'image/svg+xml';
	favicon.href = asset('images/office.svg');

	// The native About action clones this template and adds native version and
	// copyright information. Add actual readable text, not CSS-generated text or
	// a replacement dialog, so it remains selectable and accessible in the clone.
	const about = document.getElementById('about-dialog');
	if (!about) return; // The same native hook also runs on the admin shell.
	const product = about.querySelector('#product-name');
	if (product) product.textContent = 'Office';
	const info = about.querySelector('#about-dialog-info');
	if (!info || info.querySelector('.bashkitten-office-attribution')) return;
	const attribution = document.createElement('p');
	attribution.className = 'about-dialog-info-div bashkitten-office-attribution';
	attribution.textContent = 'BashKitten integrated Office built on Collabora Online. Uses LibreOffice technology.';
	info.appendChild(attribution);
	const legal = document.createElement('p');
	legal.className = 'about-dialog-info-div bashkitten-office-legal';
	const link = document.createElement('a');
	link.href = asset('branding-notices.html');
	link.target = '_blank';
	link.rel = 'noopener';
	link.textContent = 'Licenses, notices and source information';
	legal.appendChild(link);
	info.appendChild(legal);
})();
