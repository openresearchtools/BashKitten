/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "AndroidWebAuthnService.h"

#include "JavaBuiltins.h"
#include "JavaExceptions.h"
#include "WebAuthnPromiseHolder.h"
#include "WebAuthnResult.h"
#include "mozilla/java/WebAuthnTokenManagerWrappers.h"
#include "mozilla/jni/Conversions.h"

namespace mozilla {
namespace jni {
template <>
dom::AndroidWebAuthnError Java2Native(mozilla::jni::Object::Param aData,
                                      JNIEnv* aEnv) {
  MOZ_ASSERT(aData.IsInstanceOf<jni::Throwable>());
  java::sdk::Throwable::LocalRef throwable(aData);
  return dom::AndroidWebAuthnError(throwable->GetMessage()->ToString());
}
}  // namespace jni

namespace dom {

NS_IMPL_ISUPPORTS(AndroidWebAuthnService, nsIWebAuthnService)

NS_IMETHODIMP
AndroidWebAuthnService::GetIsUVPAA(bool* aAvailable) {
  // WebAuthnTransactionParent performs the asynchronous Android JNI query.
  return NS_ERROR_NOT_IMPLEMENTED;
}

NS_IMETHODIMP
AndroidWebAuthnService::MakeCredential(uint64_t aTransactionId,
                                       uint64_t aBrowsingContextId,
                                       nsIWebAuthnRegisterArgs* aArgs,
                                       nsIWebAuthnRegisterPromise* aPromise) {
  MOZ_ASSERT(NS_IsMainThread());

  Reset();
  mTransactionId = Some(aTransactionId);

  // Gecko has already validated the RP/origin and serialized all WebAuthn
  // options. Preserve that JSON and the exact client-data hash for providers.
  nsString origin;
  (void)aArgs->GetOrigin(origin);
  nsString json;
  (void)aArgs->GetJson(json);
  nsTArray<uint8_t> clientDataHash;
  (void)aArgs->GetClientDataHash(clientDataHash);
  jni::ByteBuffer::LocalRef hash = jni::ByteBuffer::New(
      static_cast<void*>(clientDataHash.Elements()), clientDataHash.Length());

  auto result = java::WebAuthnTokenManager::WebAuthnMakeCredential(
      aTransactionId, origin, hash, json);

  auto geckoResult = java::GeckoResult::LocalRef(std::move(result));

  MozPromise<RefPtr<WebAuthnRegisterResult>, AndroidWebAuthnError,
             true>::FromGeckoResult(geckoResult)
      ->Then(
          GetCurrentSerialEventTarget(), __func__,
          [aPromise =
               RefPtr{aPromise}](RefPtr<WebAuthnRegisterResult>&& aValue) {
            aPromise->Resolve(aValue);
          },
          [aPromise = RefPtr{aPromise}](AndroidWebAuthnError&& aValue) {
            aPromise->Reject(aValue.GetError());
          });

  return NS_OK;
}

NS_IMETHODIMP
AndroidWebAuthnService::GetAssertion(uint64_t aTransactionId,
                                     uint64_t aBrowsingContextId,
                                     nsIWebAuthnSignArgs* aArgs,
                                     nsIWebAuthnSignPromise* aPromise) {
  MOZ_ASSERT(NS_IsMainThread());

  Reset();
  mTransactionId = Some(aTransactionId);

  // Gecko has already validated the RP/origin and serialized all WebAuthn
  // options. Preserve that JSON and the exact client-data hash for providers.
  nsString origin;
  (void)aArgs->GetOrigin(origin);
  nsString json;
  (void)aArgs->GetJson(json);
  nsTArray<uint8_t> clientDataHash;
  (void)aArgs->GetClientDataHash(clientDataHash);
  jni::ByteBuffer::LocalRef hash = jni::ByteBuffer::New(
      static_cast<void*>(clientDataHash.Elements()), clientDataHash.Length());

  auto result = java::WebAuthnTokenManager::WebAuthnGetAssertion(
      aTransactionId, origin, hash, json);

  auto geckoResult = java::GeckoResult::LocalRef(std::move(result));
  MozPromise<RefPtr<WebAuthnSignResult>, AndroidWebAuthnError,
             true>::FromGeckoResult(geckoResult)
      ->Then(
          GetCurrentSerialEventTarget(), __func__,
          [aPromise = RefPtr{aPromise}](RefPtr<WebAuthnSignResult>&& aValue) {
            aPromise->Resolve(aValue);
          },
          [aPromise = RefPtr{aPromise}](AndroidWebAuthnError&& aValue) {
            aPromise->Reject(aValue.GetError());
          });

  return NS_OK;
}

NS_IMETHODIMP
AndroidWebAuthnService::Reset() {
  MOZ_ASSERT(NS_IsMainThread());
  if (mTransactionId.isSome()) {
    java::WebAuthnTokenManager::WebAuthnCancel(mTransactionId.extract());
  }
  return NS_OK;
}

NS_IMETHODIMP
AndroidWebAuthnService::Cancel(uint64_t aTransactionId) {
  MOZ_ASSERT(NS_IsMainThread());
  if (mTransactionId.isSome() && mTransactionId.ref() == aTransactionId) {
    return Reset();
  }
  return NS_OK;
}

NS_IMETHODIMP
AndroidWebAuthnService::HasPendingConditionalGet(uint64_t aBrowsingContextId,
                                                 const nsAString& aOrigin,
                                                 uint64_t* aRv) {
  MOZ_ASSERT(NS_IsMainThread());
  // Signal that there is no pending conditional get request, so the caller
  // will not attempt to call GetAutoFillEntries, SelectAutoFillEntry, or
  // ResumeConditionalGet (as these are not implemented).
  *aRv = 0;
  return NS_OK;
}

NS_IMETHODIMP
AndroidWebAuthnService::GetAutoFillEntries(
    uint64_t aTransactionId, nsIWebAuthnAutoFillEntriesCallback* aCallback) {
  MOZ_ASSERT(NS_IsMainThread());
  aCallback->Reject(NS_ERROR_NOT_IMPLEMENTED);
  return NS_OK;
}

NS_IMETHODIMP
AndroidWebAuthnService::GetAutoFillEntriesForRpId(
    const nsAString& aRpId, const nsTArray<nsTArray<uint8_t>>& aAllowList,
    nsIWebAuthnAutoFillEntriesCallback* aCallback) {
  MOZ_ASSERT(NS_IsMainThread());
  aCallback->Reject(NS_ERROR_NOT_IMPLEMENTED);
  return NS_OK;
}

NS_IMETHODIMP
AndroidWebAuthnService::SelectAutoFillEntry(
    uint64_t aTransactionId, const nsTArray<uint8_t>& aCredentialId) {
  MOZ_ASSERT(NS_IsMainThread());
  return NS_ERROR_NOT_IMPLEMENTED;
}

NS_IMETHODIMP
AndroidWebAuthnService::ResumeConditionalGet(uint64_t aTransactionId) {
  MOZ_ASSERT(NS_IsMainThread());
  return NS_ERROR_NOT_IMPLEMENTED;
}

NS_IMETHODIMP
AndroidWebAuthnService::PinCallback(uint64_t aTransactionId,
                                    const nsACString& aPin) {
  MOZ_ASSERT(NS_IsMainThread());
  return NS_ERROR_NOT_IMPLEMENTED;
}

NS_IMETHODIMP
AndroidWebAuthnService::SetHasAttestationConsent(uint64_t aTransactionId,
                                                 bool aHasConsent) {
  MOZ_ASSERT(NS_IsMainThread());
  return NS_ERROR_NOT_IMPLEMENTED;
}

NS_IMETHODIMP
AndroidWebAuthnService::SelectionCallback(uint64_t aTransactionId,
                                          uint64_t aIndex) {
  MOZ_ASSERT(NS_IsMainThread());
  return NS_ERROR_NOT_IMPLEMENTED;
}

NS_IMETHODIMP
AndroidWebAuthnService::AddVirtualAuthenticator(
    const nsACString& aProtocol, const nsACString& aTransport,
    bool aHasResidentKey, bool aHasUserVerification, bool aIsUserConsenting,
    bool aIsUserVerified, nsACString& aRetval) {
  MOZ_ASSERT(NS_IsMainThread());
  return NS_ERROR_NOT_IMPLEMENTED;
}

NS_IMETHODIMP
AndroidWebAuthnService::RemoveVirtualAuthenticator(
    const nsACString& aAuthenticatorId) {
  MOZ_ASSERT(NS_IsMainThread());
  return NS_ERROR_NOT_IMPLEMENTED;
}

NS_IMETHODIMP
AndroidWebAuthnService::AddCredential(const nsACString& aAuthenticatorId,
                                      const nsACString& aCredentialId,
                                      bool aIsResidentCredential,
                                      const nsACString& aRpId,
                                      const nsACString& aPrivateKey,
                                      const nsACString& aUserHandle,
                                      uint32_t aSignCount) {
  MOZ_ASSERT(NS_IsMainThread());
  return NS_ERROR_NOT_IMPLEMENTED;
}

NS_IMETHODIMP
AndroidWebAuthnService::GetCredentials(
    const nsACString& aAuthenticatorId,
    nsTArray<RefPtr<nsICredentialParameters>>& _aRetval) {
  MOZ_ASSERT(NS_IsMainThread());
  return NS_ERROR_NOT_IMPLEMENTED;
}

NS_IMETHODIMP
AndroidWebAuthnService::RemoveCredential(const nsACString& aAuthenticatorId,
                                         const nsACString& aCredentialId) {
  MOZ_ASSERT(NS_IsMainThread());
  return NS_ERROR_NOT_IMPLEMENTED;
}

NS_IMETHODIMP
AndroidWebAuthnService::RemoveAllCredentials(
    const nsACString& aAuthenticatorId) {
  MOZ_ASSERT(NS_IsMainThread());
  return NS_ERROR_NOT_IMPLEMENTED;
}

NS_IMETHODIMP
AndroidWebAuthnService::SetUserVerified(const nsACString& aAuthenticatorId,
                                        bool aIsUserVerified) {
  MOZ_ASSERT(NS_IsMainThread());
  return NS_ERROR_NOT_IMPLEMENTED;
}

NS_IMETHODIMP
AndroidWebAuthnService::Listen() {
  MOZ_ASSERT(NS_IsMainThread());
  return NS_ERROR_NOT_IMPLEMENTED;
}

NS_IMETHODIMP
AndroidWebAuthnService::RunCommand(const nsACString& aCmd) {
  MOZ_ASSERT(NS_IsMainThread());
  return NS_ERROR_NOT_IMPLEMENTED;
}

}  // namespace dom
}  // namespace mozilla
