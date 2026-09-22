/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {
  Component,
} = require("resource://devtools/client/shared/vendor/react.mjs");
const PropTypes = require("resource://devtools/client/shared/vendor/react-prop-types.mjs");
const {
  p,
} = require("resource://devtools/client/shared/vendor/react-dom-factories.js");

/**
 * Localized accessibility explanation without an external documentation control.
 */
class LearnMoreLink extends Component {
  static get propTypes() {
    return {
      className: PropTypes.string,
      l10n: PropTypes.object.isRequired,
      messageStringKey: PropTypes.string.isRequired,
    };
  }

  static get defaultProps() {
    return {
      l10n: null,
      messageStringKey: null,
    };
  }

  render() {
    const { className, l10n, messageStringKey } = this.props;
    return p({ className }, l10n.getFormatStr(messageStringKey, "").trim());
  }
}

module.exports = LearnMoreLink;
