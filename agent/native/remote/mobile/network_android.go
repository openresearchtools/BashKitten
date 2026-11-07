// SPDX-License-Identifier: AGPL-3.0-only

package mobile

import (
	"errors"
	"net"
	"net/netip"
	"sync"

	"tailscale.com/net/netmon"
)

// NetworkInterfaces supplies current Android Java network interfaces. Android
// denies Go's net.Interfaces netlink request to application UIDs.
type NetworkInterfaces interface {
	Interfaces() (string, error)
}

var networkInterfacesOnce sync.Once

// SetNetworkInterfaces installs the process-wide upstream Android hook before
// opening any connection. The first callback is retained for all native nodes;
// each monitor request obtains a fresh snapshot, including after network changes.
func SetNetworkInterfaces(getter NetworkInterfaces) error {
	if getter == nil {
		return errors.New("Android network interface provider required")
	}
	networkInterfacesOnce.Do(func() {
		netmon.RegisterInterfaceGetter(func() ([]netmon.Interface, error) {
			text, err := getter.Interfaces()
			if err != nil {
				return nil, err
			}
			var interfaces []struct {
				Name         string
				Index, MTU   int
				Up           bool
				Broadcast    bool
				Loopback     bool
				PointToPoint bool
				Multicast    bool
				Addresses    []string
			}
			if err := decode([]byte(text), &interfaces); err != nil {
				return nil, err
			}
			result := make([]netmon.Interface, 0, len(interfaces))
			for _, value := range interfaces {
				if value.Name == "" || value.Index < 0 || value.MTU < 0 {
					return nil, errors.New("invalid Android network interface")
				}
				iface := netmon.Interface{Interface: &net.Interface{Name: value.Name, Index: value.Index, MTU: value.MTU}, AltAddrs: []net.Addr{}}
				for _, flag := range []struct {
					set  bool
					flag net.Flags
				}{{value.Up, net.FlagUp}, {value.Broadcast, net.FlagBroadcast}, {value.Loopback, net.FlagLoopback}, {value.PointToPoint, net.FlagPointToPoint}, {value.Multicast, net.FlagMulticast}} {
					if flag.set {
						iface.Flags |= flag.flag
					}
				}
				for _, address := range value.Addresses {
					prefix, err := netip.ParsePrefix(address)
					if err != nil {
						return nil, errors.New("invalid Android interface address")
					}
					iface.AltAddrs = append(iface.AltAddrs, &net.IPNet{IP: net.IP(prefix.Addr().AsSlice()), Mask: net.CIDRMask(prefix.Bits(), prefix.Addr().BitLen())})
				}
				result = append(result, iface)
			}
			return result, nil
		})
	})
	return nil
}
