/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

class InactiveCssTooltipHelper {
  /**
   * Fill the tooltip with inactive CSS information.
   */
  async setContent(data, tooltip) {
    const fragment = this.getTemplate(data, tooltip);

    await tooltip.setLocalizedFragment(fragment, { width: 267 });
  }

  /**
   * Get the template that the Fluent string will be merged with. This template
   * looks something like this but there is a variable amount of properties in the
   * fix section:
   *
   * <div class="devtools-tooltip-inactive-css">
   *   <p data-l10n-id="inactive-css-not-grid-or-flex-container"
   *      data-l10n-args="{&quot;property&quot;:&quot;align-content&quot;}">
   *   </p>
   *   <p data-l10n-id="inactive-css-not-grid-or-flex-container-fix">
   *     <span data-l10n-name="link" hidden></span>
   *   </p>
   * </div>
   *
   * @param {object} data
   *        An object in the following format: {
   *          fixId: "inactive-css-not-grid-item-fix-2", // Fluent id containing the
   *                                                     // Inactive CSS fix.
   *          msgId: "inactive-css-not-grid-item", // Fluent id containing the
   *                                               // Inactive CSS message.
   *          property: "color", // Property name
   *        }
   * @param {HTMLTooltip} tooltip
   *        The tooltip we are targetting.
   */
  getTemplate(data, tooltip) {
    const XHTML_NS = "http://www.w3.org/1999/xhtml";
    const { fixId, msgId, property, display, lineCount } = data;
    const { doc } = tooltip;

    const templateNode = doc.createElementNS(XHTML_NS, "template");

    // eslint-disable-next-line
    templateNode.innerHTML = `
    <div class="devtools-tooltip-inactive-css">
      <p data-l10n-id="${msgId}"
         data-l10n-args='${JSON.stringify({ property, display, lineCount })}'>
      </p>
      <p data-l10n-id="${fixId}">
        <span data-l10n-name="link" hidden></span>
      </p>
    </div>`;

    return doc.importNode(templateNode.content, true);
  }

  destroy() {}
}

module.exports = InactiveCssTooltipHelper;
