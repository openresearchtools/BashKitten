/* Shared About view for the web UI and the offline Android/Linux shells. */
window.renderBashKittenAbout = (root, { version = '', notice, licenses, loadLicenses, license = 'GPL-3.0-only', description = 'A browser interface for the Pi coding agent.' }) => {
  root.innerHTML = `<h3></h3>
    <p data-description></p>
    <p data-notice></p>
    <p><a href="https://github.com/openresearchtools/bashkitten" target="_blank" rel="noopener">Source code</a></p>
    <button type="button" id="viewLicenses">Licenses</button>
    <div id="licenseList" class="settings-section"></div>`;
  root.querySelector('h3').textContent = ['BashKitten', version].filter(Boolean).join(' ');
  root.querySelector('[data-description]').textContent = `${description} ${license}. No warranty.`;
  root.querySelector('[data-notice]').textContent = notice;
  const button = root.querySelector('#viewLicenses'), list = root.querySelector('#licenseList');
  button.onclick = async () => {
    button.disabled = true;
    try {
      const records = licenses || await loadLicenses();
      list.replaceChildren();
      for (const entry of records) {
        const detail = document.createElement('details'), summary = document.createElement('summary');
        summary.textContent = [entry.name, entry.version, entry.license].filter(Boolean).join(' · ');
        detail.append(summary);
        detail.ontoggle = () => { if (detail.open && detail.childElementCount === 1) {
          const text = document.createElement('pre');
          text.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;max-height:24rem;overflow:auto';
          text.textContent = entry.text; detail.append(text);
        } };
        list.append(detail);
      }
      button.textContent = 'Licenses loaded';
    } catch (error) { button.disabled = false; list.textContent = error.message; }
  };
};
