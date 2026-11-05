/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const TASKARIAN_THEME_VARIABLES = [
  ["--color-accent-primary", "taskarian_accent_primary"],
  ["--color-accent-primary-hover", "taskarian_accent_primary_hover"],
  ["--color-accent-primary-active", "taskarian_accent_primary_active"],
  [
    "--background-color-information",
    "taskarian_background_color_information",
  ],
  ["--icon-color-information", "taskarian_icon_color_information"],
];

function themeColorToCSS(value) {
  if (!value || typeof value !== "object") {
    return value;
  }
  const { r, g, b, a } = value;
  return a === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
}

export const TaskarianContentTheme = {
  apply(document, data) {
    const root = document.documentElement;
    for (const [variableName, propertyName] of TASKARIAN_THEME_VARIABLES) {
      const value = themeColorToCSS(data?.[propertyName]);
      if (value) {
        root.style.setProperty(variableName, value);
      } else {
        root.style.removeProperty(variableName);
      }
    }
  },
};
