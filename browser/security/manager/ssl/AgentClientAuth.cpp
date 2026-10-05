// SPDX-License-Identifier: AGPL-3.0-only
#include "AgentClientAuth.h"

#include <cstring>

#include "CertVerifier.h"
#include "mozilla/ClearOnShutdown.h"
#include "mozilla/StaticMutex.h"
#include "mozilla/StaticPtr.h"
#include "nsNSSComponent.h"
#include "nsThreadUtils.h"
#include "nsXULAppAPI.h"

namespace mozilla::psm {
namespace {

struct ClearKeyBytes {
  void operator()(SECItem* bytes) const { SECITEM_ZfreeItem(bytes, true); }
};
using KeyBytes = UniquePtr<SECItem, ClearKeyBytes>;

struct AgentClientIdentity {
  nsCString host;
  OriginAttributes attributes;
  OriginAttributes networkAttributes;
  nsTArray<uint8_t> certificate;
  KeyBytes key;

  bool Matches(const nsACString& name, const OriginAttributes& attrs) const {
    return host == name && (attributes == attrs || networkAttributes == attrs);
  }
};

StaticMutex sAgentClientAuthMutex;
StaticAutoPtr<nsTArray<AgentClientIdentity>> sAgentClientIdentities;

UniqueSECKEYPrivateKey ImportAgentKey(SECItem* pkcs8) {
  // A session object on the internal crypto slot, never a persistent database
  // key or an OS KeyChain import. NSS destroys it with its owning key handle.
  UniquePK11SlotInfo slot(PK11_GetInternalSlot());
  SECKEYPrivateKey* key = nullptr;
  if (!slot || PK11_ImportDERPrivateKeyInfoAndReturnKey(
                   slot.get(), pkcs8, nullptr, nullptr, false, false,
                   KU_DIGITAL_SIGNATURE, &key, nullptr) != SECSuccess) {
    return nullptr;
  }
  return UniqueSECKEYPrivateKey(key);
}

UniqueCERTCertificate DecodeAgentCertificate(const nsTArray<uint8_t>& bytes) {
  SECItem der = {siBuffer, const_cast<uint8_t*>(bytes.Elements()),
                 static_cast<unsigned int>(bytes.Length())};
  return UniqueCERTCertificate(CERT_NewTempCertificate(
      CERT_GetDefaultCertDB(), &der, nullptr, false, true));
}

bool UsableAgentCertificate(CERTCertificate* cert) {
  return cert && !CERT_IsCACert(cert, nullptr) &&
         CERT_CheckCertValidTimes(cert, PR_Now(), false) == secCertTimeValid &&
         CERT_CheckKeyUsage(cert, KU_DIGITAL_SIGNATURE) == SECSuccess &&
         (cert->nsCertType & NS_CERT_TYPE_SSL_CLIENT);
}

}  // namespace

bool IsProtectedAgentContext(const OriginAttributes& attributes) {
  return (attributes.mUserContextId >= 0xB4500000 &&
          attributes.mUserContextId <= 0xB450FFFF) ||
         StringBeginsWith(attributes.mGeckoViewSessionContextId,
                          u"gvctx626173686b697474656e2d6167656e742d"_ns);
}

nsresult SetAgentClientAuth(const nsACString& host,
                           const OriginAttributes& attributes,
                           const OriginAttributes& networkAttributes,
                           const nsTArray<uint8_t>& certificate,
                           const nsTArray<uint8_t>& pkcs8) {
  MOZ_ASSERT(NS_IsMainThread());
  MOZ_ASSERT(XRE_IsParentProcess());
  if (!EnsureNSSInitializedChromeOrContent()) return NS_ERROR_FAILURE;
  if (certificate.IsEmpty() || pkcs8.IsEmpty() ||
      certificate.Length() > 65536 || pkcs8.Length() > 65536 ||
      !GetAgentRoot(host, attributes) ||
      !GetAgentRoot(host, networkAttributes)) {
    return NS_ERROR_INVALID_ARG;
  }
  auto cert = DecodeAgentCertificate(certificate);
  if (!UsableAgentCertificate(cert.get())) return NS_ERROR_INVALID_ARG;
  KeyBytes bytes(SECITEM_AllocItem(nullptr, nullptr,
                                 static_cast<unsigned int>(pkcs8.Length())));
  if (!bytes) return NS_ERROR_OUT_OF_MEMORY;
  memcpy(bytes->data, pkcs8.Elements(), pkcs8.Length());
  auto key = ImportAgentKey(bytes.get());
  if (!key || (key->keyType != ecKey && key->keyType != rsaKey)) {
    return NS_ERROR_INVALID_ARG;
  }
  UniqueSECKEYPublicKey publicKey(SECKEY_ConvertToPublicKey(key.get()));
  UniqueSECKEYPublicKey certificateKey(CERT_ExtractPublicKey(cert.get()));
  if (!publicKey || !certificateKey) return NS_ERROR_INVALID_ARG;
  UniqueSECItem keySPKI(SECKEY_EncodeDERSubjectPublicKeyInfo(publicKey.get()));
  UniqueSECItem certSPKI(SECKEY_EncodeDERSubjectPublicKeyInfo(certificateKey.get()));
  if (!keySPKI || !certSPKI ||
      SECITEM_CompareItem(keySPKI.get(), certSPKI.get()) != SECEqual) {
    return NS_ERROR_INVALID_ARG;
  }

  StaticMutexAutoLock lock(sAgentClientAuthMutex);
  if (!sAgentClientIdentities) {
    sAgentClientIdentities = new nsTArray<AgentClientIdentity>();
    ClearOnShutdown(&sAgentClientIdentities);
  }
  for (auto& entry : *sAgentClientIdentities) {
    if (entry.Matches(host, attributes)) entry.key.reset();
  }
  for (auto& entry : *sAgentClientIdentities) {
    if (entry.host == host && entry.attributes == attributes &&
        entry.networkAttributes == networkAttributes &&
        entry.certificate == certificate) {
      entry.key = std::move(bytes);
      return NS_OK;
    }
  }
  sAgentClientIdentities->AppendElement(AgentClientIdentity{
      nsCString(host), attributes, networkAttributes, certificate.Clone(),
      std::move(bytes)});
  return NS_OK;
}

void ClearAgentClientAuth(const nsACString& host,
                          const OriginAttributes& attributes) {
  MOZ_ASSERT(NS_IsMainThread());
  StaticMutexAutoLock lock(sAgentClientAuthMutex);
  if (!sAgentClientIdentities) return;
  for (auto& entry : *sAgentClientIdentities) {
    if (entry.Matches(host, attributes)) entry.key.reset();
  }
  // Retain only public certificate identifiers until shutdown. A cached IPC
  // object for a removed identity must keep failing, never use a generic key.
}

bool SelectAgentClientAuth(const nsACString& host,
                          const OriginAttributes& attributes, int32_t port,
                          nsTArray<uint8_t>& certificate,
                          nsTArray<nsTArray<uint8_t>>& chain) {
  if (!IsProtectedAgentContext(attributes)) return false;
  certificate.Clear();
  chain.Clear();
  if (port != 443) return true;
  auto root = GetAgentRoot(host, attributes);
  if (!root) return true;
  StaticMutexAutoLock lock(sAgentClientAuthMutex);
  if (!sAgentClientIdentities) return true;
  for (const auto& entry : *sAgentClientIdentities) {
    if (entry.key && entry.Matches(host, attributes)) {
      auto cert = DecodeAgentCertificate(entry.certificate);
      if (UsableAgentCertificate(cert.get())) {
        certificate = entry.certificate.Clone();
        chain.AppendElement(certificate.Clone());
        chain.AppendElement(std::move(root.ref()));
      }
      break;
    }
  }
  return true;
}

bool IsAgentClientCertificate(const nsTArray<uint8_t>& certificate) {
  StaticMutexAutoLock lock(sAgentClientAuthMutex);
  if (sAgentClientIdentities) {
    for (const auto& entry : *sAgentClientIdentities) {
      if (entry.certificate == certificate) return true;
    }
  }
  return false;
}

nsTArray<nsTArray<uint8_t>> AgentClientCertificates() {
  nsTArray<nsTArray<uint8_t>> certificates;
  StaticMutexAutoLock lock(sAgentClientAuthMutex);
  if (sAgentClientIdentities) {
    for (const auto& entry : *sAgentClientIdentities) {
      if (entry.key && !certificates.Contains(entry.certificate)) {
        certificates.AppendElement(entry.certificate.Clone());
      }
    }
  }
  return certificates;
}

bool AgentClientKey(const nsTArray<uint8_t>& certificate,
                    UniqueSECKEYPrivateKey& key) {
  MOZ_ASSERT(XRE_IsParentProcess());
  key.reset();
  bool known = false;
  StaticMutexAutoLock lock(sAgentClientAuthMutex);
  if (sAgentClientIdentities) {
    for (const auto& entry : *sAgentClientIdentities) {
      if (entry.certificate != certificate) continue;
      known = true;
      if (entry.key) {
        auto cert = DecodeAgentCertificate(certificate);
        if (UsableAgentCertificate(cert.get())) key = ImportAgentKey(entry.key.get());
        break;
      }
    }
  }
  return known;
}

}  // namespace mozilla::psm
