// Copyright 2026 The Torkitten Authors (Apache-2.0).
// BashKitten adaptations: SPDX-License-Identifier: AGPL-3.0-only
package bundle

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/draw"
	_ "image/jpeg"
	"image/png"
	"strings"

	"github.com/boombuler/barcode"
	"github.com/boombuler/barcode/qr"
	"github.com/makiuchi-d/gozxing"
	"github.com/makiuchi-d/gozxing/qrcode"
)

// PNG encodes the complete encrypted payload or returns the encoder's capacity
// error. The four-module quiet zone is part of the downloadable image.
func PNG(text string) ([]byte, error) {
	if !strings.HasPrefix(text, "TK2:") {
		return nil, errors.New("encrypted connection required")
	}
	code, err := qr.Encode(text, qr.M, qr.Auto)
	if err != nil {
		return nil, err
	}
	const scale = 4
	symbol, err := barcode.Scale(code, code.Bounds().Dx()*scale, code.Bounds().Dy()*scale)
	if err != nil {
		return nil, err
	}
	const border = 4 * scale
	out := image.NewGray(image.Rect(0, 0, symbol.Bounds().Dx()+2*border, symbol.Bounds().Dy()+2*border))
	draw.Draw(out, out.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	draw.Draw(out, symbol.Bounds().Add(image.Pt(border, border)), symbol, image.Point{}, draw.Src)
	var encoded bytes.Buffer
	err = png.Encode(&encoded, out)
	return encoded.Bytes(), err
}

// ReadImage decodes locally; it never opens a QR URL or sends image data away.
// Camera callers that already use native ZXing pass its text to Decrypt instead.
func ReadImage(data []byte) (string, error) {
	im, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return "", errors.New("could not read connection image")
	}
	bmp, err := gozxing.NewBinaryBitmapFromImage(im)
	if err != nil {
		return "", err
	}
	code, err := qrcode.NewQRCodeReader().Decode(bmp, nil)
	if err != nil || !strings.HasPrefix(code.GetText(), "TK2:") {
		return "", errors.New("connection QR code not found")
	}
	return code.GetText(), nil
}
