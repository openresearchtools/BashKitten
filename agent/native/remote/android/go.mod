module github.com/openresearchtools/bashkitten/remote/androidbuild

go 1.27.0

require (
	github.com/openresearchtools/bashkitten/remote v0.0.0
	golang.org/x/mobile v0.0.0-20260908204917-8b95e45f8d3e
)

require (
	golang.org/x/mod v0.41.0 // indirect
	golang.org/x/sync v0.23.0 // indirect
	golang.org/x/tools v0.50.0 // indirect
)

tool (
	golang.org/x/mobile/cmd/gobind
	golang.org/x/mobile/cmd/gomobile
)

replace github.com/openresearchtools/bashkitten/remote => ..

replace golang.org/x/mobile => ../../../../auth/mobile

replace github.com/jpillora/chisel => ../../../../auth/chisel

replace filippo.io/age => ../../../../auth/age

replace github.com/boombuler/barcode => ../../../../auth/barcode

replace github.com/makiuchi-d/gozxing => ../../../../auth/gozxing
