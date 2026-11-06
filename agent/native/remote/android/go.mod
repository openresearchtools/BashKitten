module github.com/openresearchtools/Taskarian/remote/androidbuild

go 1.27.3

require (
	github.com/google/go-cmp v0.7.0 // indirect
	github.com/openresearchtools/Taskarian/remote v0.0.0
	golang.org/x/mobile v0.0.0-20260908204917-8b95e45f8d3e // indirect
	golang.org/x/mod v0.41.0 // indirect
	golang.org/x/sync v0.24.0 // indirect
	golang.org/x/tools v0.50.0 // indirect
)

tool (
	golang.org/x/mobile/cmd/gobind
	golang.org/x/mobile/cmd/gomobile
)

replace github.com/openresearchtools/Taskarian/remote => ..

replace golang.org/x/mobile => ../../../../auth/mobile

replace github.com/jpillora/chisel => ../../../../auth/chisel

replace filippo.io/age => ../../../../auth/age

replace github.com/boombuler/barcode => ../../../../auth/barcode

replace github.com/makiuchi-d/gozxing => ../../../../auth/gozxing

replace github.com/tailscale/tailcat => ../../../../auth/tailcat

replace tailscale.com => ../../../../auth/tailscale

replace github.com/cloudflare/cloudflared => ../../../../auth/cloudflared
