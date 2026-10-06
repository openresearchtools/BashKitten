/* SPDX-License-Identifier: AGPL-3.0-only */
importScripts("chrome://browser/content/bashkitten/agent/jsQR.js");

self.onmessage = ({ data: bitmap }) => {
  try {
    const { width, height } = bitmap;
    if (!width || !height) throw new Error("The QR image dimensions are invalid.");
    const scale = Math.min(1, 1600 / Math.max(width, height));
    const canvas = new OffscreenCanvas(Math.round(width * scale), Math.round(height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = self.jsQR(image.data, image.width, image.height);
    if (!result?.data) throw new Error("No connection QR code was found.");
    self.postMessage({ text: result.data });
  } catch (error) {
    self.postMessage({ error: error.message });
  } finally {
    bitmap.close();
  }
};
