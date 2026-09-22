/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
// @ts-check

/**
 * @typedef {{}} Props - This is an empty object.
 */

"use strict";

const {
  PureComponent,
  createFactory,
} = require("resource://devtools/client/shared/vendor/react.mjs");
const {
  div,
  p,
  span,
} = require("resource://devtools/client/shared/vendor/react-dom-factories.js");
const Localized = createFactory(
  require("resource://devtools/client/shared/vendor/fluent-react.js").Localized
);

/**
 * This component provides a helpful description for what is going on in the component
 * and provides some external links.
 *
 * @augments {React.PureComponent<Props>}
 */
class Description extends PureComponent {
  render() {
    return div(
      { className: "perf-description" },
      Localized(
        {
          id: "perftools-description-intro",
          a: span({ hidden: true }),
        },
        p({})
      )
    );
  }
}

module.exports = Description;
