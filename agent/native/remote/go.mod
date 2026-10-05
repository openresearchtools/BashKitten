module github.com/openresearchtools/bashkitten/remote

go 1.27.0

require (
	filippo.io/age v1.3.2
	github.com/boombuler/barcode v1.1.0
	github.com/go-crypt/crypt v0.14.15
	github.com/gorilla/websocket v1.5.3
	github.com/jpillora/chisel v1.12.0
	github.com/makiuchi-d/gozxing v0.1.1
	golang.org/x/crypto v0.55.0
	golang.org/x/net v0.57.0
)

require (
	filippo.io/hpke v0.4.0 // indirect
	github.com/armon/go-socks5 v0.0.0-20160902184237-e75332964ef5 // indirect
	github.com/fsnotify/fsnotify v1.10.1 // indirect
	github.com/go-crypt/x v0.4.16 // indirect
	github.com/jpillora/sizestr v1.0.0 // indirect
	golang.org/x/sync v0.22.0 // indirect
	golang.org/x/sys v0.47.0 // indirect
	golang.org/x/text v0.41.0 // indirect
	golang.org/x/xerrors v0.0.0-20200804184101-5ec99f83aff1 // indirect
)

replace github.com/jpillora/chisel => ../../../auth/chisel

replace filippo.io/age => ../../../auth/age

replace github.com/boombuler/barcode => ../../../auth/barcode

replace github.com/makiuchi-d/gozxing => ../../../auth/gozxing
