// SPDX-License-Identifier: AGPL-3.0-only
#ifndef BashKittenAgentClientAuth_h
#define BashKittenAgentClientAuth_h

#include "ScopedNSSTypes.h"
#include "mozilla/OriginAttributes.h"
#include "nsString.h"
#include "nsTArray.h"

namespace mozilla::psm {

bool IsProtectedAgentContext(const OriginAttributes& attributes);

// Called only by privileged parent-process enrollment. Keys stay in memory;
// persistence belongs to the native client's existing protected secret store.
nsresult SetAgentClientAuth(const nsACString& host,
                           const OriginAttributes& attributes,
                           const OriginAttributes& networkAttributes,
                           const nsTArray<uint8_t>& certificate,
                           const nsTArray<uint8_t>& pkcs8);
void ClearAgentClientAuth(const nsACString& host,
                          const OriginAttributes& attributes);

// True means this is a protected Agent request, including when there is no
// usable credential. Such a request must never open the ordinary cert picker.
bool SelectAgentClientAuth(const nsACString& host,
                          const OriginAttributes& attributes, int32_t port,
                          nsTArray<uint8_t>& certificate,
                          nsTArray<nsTArray<uint8_t>>& chain);

bool IsAgentClientCertificate(const nsTArray<uint8_t>& certificate);
nsTArray<nsTArray<uint8_t>> AgentClientCertificates();

// For NSS's trusted socket-process signing bridge, not content IPC. True also
// covers revoked credentials, returning a null key so they cannot be looked up
// through the ordinary certificate store after removal.
bool AgentClientKey(const nsTArray<uint8_t>& certificate,
                    UniqueSECKEYPrivateKey& key);

}  // namespace mozilla::psm
#endif
