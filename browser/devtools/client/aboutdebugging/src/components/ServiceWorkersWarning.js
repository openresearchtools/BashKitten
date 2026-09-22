/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {
  createFactory,
  PureComponent,
} = require("resource://devtools/client/shared/vendor/react.mjs");
const dom = require("resource://devtools/client/shared/vendor/react-dom-factories.js");

const FluentReact = require("resource://devtools/client/shared/vendor/fluent-react.js");
const Localized = createFactory(FluentReact.Localized);

const Message = createFactory(
  require("resource://devtools/client/aboutdebugging/src/components/shared/Message.js")
);

const {
  MESSAGE_LEVEL,
} = require("resource://devtools/client/aboutdebugging/src/constants.js");
class ServiceWorkersWarning extends PureComponent {
  render() {
    return Message(
      {
        level: MESSAGE_LEVEL.WARNING,
        isCloseable: true,
      },
      Localized(
        {
          id: "about-debugging-runtime-service-workers-not-compatible",
          a: dom.span({ hidden: true }),
        },
        dom.p(
          {
            className: "qa-service-workers-warning",
          },
          "about-debugging-runtime-service-workers-not-compatible"
        )
      )
    );
  }
}

module.exports = ServiceWorkersWarning;
