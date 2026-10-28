// SPDX-License-Identifier: AGPL-3.0-only
// Quantum's typed call boundary over the licensed native cache. Storage,
// expiration checks, synchronization and cleanup remain in patrickmn/go-cache.
package cache

import (
	"math/rand"
	"time"

	native "github.com/patrickmn/go-cache"
)

type KeyCache[T any] struct {
	cache   *native.Cache
	expires time.Duration
}

// A typed carrier also preserves an explicitly cached nil interface value.
type value[T any] struct{ item T }

func NewCache[T any](settings ...time.Duration) *KeyCache[T] {
	expires, cleanup := 24*time.Hour, time.Hour
	if len(settings) > 0 {
		expires = settings[0]
	}
	if len(settings) > 1 {
		cleanup = settings[1]
	}
	cleanup += time.Second + time.Duration(rand.Int63n(int64(time.Second)))
	if cleanup <= 0 {
		panic("cache cleanup interval must be positive")
	}
	return &KeyCache[T]{cache: native.New(expires, cleanup), expires: expires}
}

func (c *KeyCache[T]) Set(key string, item T) { c.SetWithExp(key, item, c.expires) }

func (c *KeyCache[T]) SetWithExp(key string, item T, expires time.Duration) {
	// Quantum treats nonpositive durations as expired. The native library uses
	// those values as default/no-expiration sentinels, so never forward them.
	if expires <= 0 {
		c.cache.Delete(key)
		return
	}
	c.cache.Set(key, value[T]{item}, expires)
}

func (c *KeyCache[T]) Get(key string) (T, bool) {
	item, found := c.cache.Get(key)
	if found {
		return item.(value[T]).item, true
	}
	var zero T
	return zero, false
}

func (c *KeyCache[T]) Delete(key string) { c.cache.Delete(key) }
func (c *KeyCache[T]) ClearAll()         { c.cache.Flush() }
