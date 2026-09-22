/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "nsCertOverrideService.h"

#include "NSSCertDBTrustDomain.h"
#include "CertVerifier.h"
#include "cert.h"
#include "mozilla/Assertions.h"
#include "mozilla/ScopeExit.h"
#include "mozilla/TaskQueue.h"
#include "mozilla/glean/SecurityManagerSslMetrics.h"
#include "mozilla/TextUtils.h"
#include "mozilla/Tokenizer.h"
#include "mozilla/dom/ToJSValue.h"
#include "nsAppDirectoryServiceDefs.h"
#include "nsCRT.h"
#include "nsILineInputStream.h"
#ifdef ENABLE_WEBDRIVER
#  include "nsIMarionette.h"
#endif
#include "nsIObserver.h"
#include "nsIObserverService.h"
#include "nsIOutputStream.h"
#ifdef ENABLE_WEBDRIVER
#  include "nsIRemoteAgent.h"
#endif
#include "nsISafeOutputStream.h"
#include "nsIX509Cert.h"
#include "nsNSSCertificate.h"
#include "nsNSSComponent.h"
#include "nsNetUtil.h"
#include "nsStreamUtils.h"
#include "nsThreadUtils.h"

using namespace mozilla;
using namespace mozilla::psm;

#define CERT_OVERRIDE_FILE_NAME "cert_override.txt"

class WriterRunnable : public Runnable {
 public:
  WriterRunnable(nsCertOverrideService* aService, nsCString& aData,
                 nsCOMPtr<nsIFile> aFile)
      : Runnable("nsCertOverrideService::WriterRunnable"),
        mCertOverrideService(aService),
        mData(aData),
        mFile(std::move(aFile)) {}

  NS_IMETHOD
  Run() override {
    mCertOverrideService->AssertOnTaskQueue();
    nsresult rv;

    auto removeShutdownBlockerOnExit =
        MakeScopeExit([certOverrideService = mCertOverrideService]() {
          NS_DispatchToMainThread(NS_NewRunnableFunction(
              "nsCertOverrideService::RemoveShutdownBlocker",
              [certOverrideService] {
                certOverrideService->RemoveShutdownBlocker();
              }));
        });

    nsCOMPtr<nsIOutputStream> outputStream;
    rv = NS_NewSafeLocalFileOutputStream(
        getter_AddRefs(outputStream), mFile,
        PR_CREATE_FILE | PR_TRUNCATE | PR_WRONLY);
    NS_ENSURE_SUCCESS(rv, rv);

    const char* ptr = mData.get();
    uint32_t remaining = mData.Length();
    uint32_t written = 0;
    while (remaining > 0) {
      rv = outputStream->Write(ptr, remaining, &written);
      NS_ENSURE_SUCCESS(rv, rv);
      remaining -= written;
      ptr += written;
    }

    nsCOMPtr<nsISafeOutputStream> safeStream = do_QueryInterface(outputStream);
    MOZ_ASSERT(safeStream);
    rv = safeStream->Finish();
    NS_ENSURE_SUCCESS(rv, rv);

    return NS_OK;
  }

 private:
  const RefPtr<nsCertOverrideService> mCertOverrideService;
  nsCString mData;
  const nsCOMPtr<nsIFile> mFile;
};

NS_IMPL_ISUPPORTS(nsCertOverride, nsICertOverride)

NS_IMETHODIMP
nsCertOverride::GetAsciiHost(/*out*/ nsACString& aAsciiHost) {
  aAsciiHost = mAsciiHost;
  return NS_OK;
}

NS_IMETHODIMP
nsCertOverride::GetFingerprint(/*out*/ nsACString& aFingerprint) {
  aFingerprint = mFingerprint;
  return NS_OK;
}

NS_IMETHODIMP
nsCertOverride::GetPort(/*out*/ int32_t* aPort) {
  *aPort = mPort;
  return NS_OK;
}

NS_IMETHODIMP
nsCertOverride::GetHostPort(/*out*/ nsACString& aHostPort) {
  nsCertOverrideService::GetHostWithPort(mAsciiHost, mPort, aHostPort);
  return NS_OK;
}

NS_IMETHODIMP
nsCertOverride::GetOriginAttributes(
    JSContext* aCtx, /*out*/ JS::MutableHandle<JS::Value> aValue) {
  if (ToJSValue(aCtx, mOriginAttributes, aValue)) {
    return NS_OK;
  }
  return NS_ERROR_FAILURE;
}

NS_IMPL_ISUPPORTS(nsCertOverrideService, nsICertOverrideService, nsIObserver,
                  nsISupportsWeakReference, nsIAsyncShutdownBlocker)

nsCertOverrideService::nsCertOverrideService()
    : mMutex("nsCertOverrideService.mutex"),
      mDisableAllSecurityCheck(false),
      mPendingWriteCount(0) {
  nsCOMPtr<nsIEventTarget> target =
      do_GetService(NS_STREAMTRANSPORTSERVICE_CONTRACTID);
  MOZ_ASSERT(target);

  mWriterTaskQueue = TaskQueue::Create(target.forget(), "CertOverrideService");
}

nsCertOverrideService::~nsCertOverrideService() = default;

static nsCOMPtr<nsIAsyncShutdownClient> GetShutdownBarrier() {
  MOZ_ASSERT(NS_IsMainThread());
  nsCOMPtr<nsIAsyncShutdownService> svc =
      mozilla::services::GetAsyncShutdownService();
  MOZ_RELEASE_ASSERT(svc);

  nsCOMPtr<nsIAsyncShutdownClient> barrier;
  nsresult rv = svc->GetProfileBeforeChange(getter_AddRefs(barrier));

  MOZ_RELEASE_ASSERT(NS_SUCCEEDED(rv));
  MOZ_RELEASE_ASSERT(barrier);
  return barrier;
}

nsresult nsCertOverrideService::Init() {
  if (!NS_IsMainThread()) {
    MOZ_ASSERT_UNREACHABLE("nsCertOverrideService initialized off main thread");
    return NS_ERROR_NOT_SAME_THREAD;
  }

  nsCOMPtr<nsIObserverService> observerService =
      mozilla::services::GetObserverService();

  // If we cannot add ourselves as a profile change observer, then we will not
  // attempt to read/write any settings file. Otherwise, we would end up
  // reading/writing the wrong settings file after a profile change.
  if (observerService) {
    observerService->AddObserver(this, "last-pb-context-exited", false);
    observerService->AddObserver(this, "profile-do-change", true);
    // simulate a profile change so we read the current profile's settings file
    Observe(nullptr, "profile-do-change", nullptr);
  }

  return NS_OK;
}

NS_IMETHODIMP
nsCertOverrideService::Observe(nsISupports*, const char* aTopic,
                               const char16_t* aData) {
  if (!nsCRT::strcmp(aTopic, "profile-do-change")) {
    // The profile has already changed.
    // Now read from the new profile location.
    // we also need to update the cached file location

    MutexAutoLock lock(mMutex);

    nsresult rv = NS_GetSpecialDirectory(NS_APP_USER_PROFILE_50_DIR,
                                         getter_AddRefs(mSettingsFile));
    if (NS_SUCCEEDED(rv)) {
      mSettingsFile->AppendNative(nsLiteralCString(CERT_OVERRIDE_FILE_NAME));
    } else {
      mSettingsFile = nullptr;
    }
    Read(lock);
    CountPermanentOverrideTelemetry(lock);
  } else if (!nsCRT::strcmp(aTopic, "last-pb-context-exited")) {
    ClearValidityOverride("all:temporary-certificates"_ns, 0,
                          OriginAttributes());
  }

  return NS_OK;
}

void nsCertOverrideService::RemoveAllTemporaryOverrides() {
  MutexAutoLock lock(mMutex);
  bool removedAny = false;
  for (auto iter = mSettingsTable.Iter(); !iter.Done(); iter.Next()) {
    nsCertOverrideEntry* entry = iter.Get();
    if (entry->mSettings->mIsTemporary) {
      iter.Remove();
      removedAny = true;
    }
  }
  if (removedAny) {
    nsCOMPtr<nsIObserverService> os = mozilla::services::GetObserverService();
    if (os) {
      os->NotifyObservers(nullptr, "net:cancel-all-connections", nullptr);
    }
  }
  // no need to write, as temporaries are never written to disk
}

static const char sSHA256OIDString[] = "OID.2.16.840.1.101.3.4.2.1";
nsresult nsCertOverrideService::Read(const MutexAutoLock& aProofOfLock) {
  mMutex.AssertCurrentThreadOwns();
  // If we don't have a profile, then we won't try to read any settings file.
  if (!mSettingsFile) return NS_OK;

  nsresult rv;
  nsCOMPtr<nsIInputStream> fileInputStream;
  rv = NS_NewLocalFileInputStream(getter_AddRefs(fileInputStream),
                                  mSettingsFile);
  if (NS_FAILED(rv)) {
    return rv;
  }

  nsCOMPtr<nsILineInputStream> lineInputStream =
      do_QueryInterface(fileInputStream, &rv);
  if (NS_FAILED(rv)) {
    return rv;
  }

  nsAutoCString buffer;
  bool isMore = true;

  // Each line is of the form:
  // host:port:originAttributes \t sSHA256OIDString \t fingerprint \t
  // There may be some "bits" identifiers and "dbKey" after the `fingerprint`
  // field in 'fingerprint \t \t dbKey' format, but these are now ignored.
  // Lines that don't match this form are silently dropped.

  while (isMore && NS_SUCCEEDED(lineInputStream->ReadLine(buffer, &isMore))) {
    if (buffer.IsEmpty() || buffer.First() == '#') {
      continue;
    }

    Tokenizer parser(buffer);
    nsDependentCSubstring host;
    if (parser.CheckChar('[')) {  // this is a IPv6 address
      if (!parser.ReadUntil(Tokenizer::Token::Char(']'), host) ||
          host.Length() == 0 || !parser.CheckChar(':')) {
        continue;
      }
    } else if (!parser.ReadUntil(Tokenizer::Token::Char(':'), host) ||
               host.Length() == 0) {
      continue;
    }
    int32_t port = -1;
    if (!parser.ReadInteger(&port)) {
      continue;
    }
    OriginAttributes attributes;
    if (parser.CheckChar(':')) {
      nsDependentCSubstring attributesString;
      if (!parser.ReadUntil(Tokenizer::Token::Whitespace(), attributesString) ||
          !attributes.PopulateFromSuffix(attributesString)) {
        continue;
      }
    } else if (!parser.CheckWhite()) {
      continue;
    }
    nsDependentCSubstring algorithm;
    if (!parser.ReadUntil(Tokenizer::Token::Whitespace(), algorithm) ||
        algorithm != sSHA256OIDString) {
      continue;
    }
    nsDependentCSubstring fingerprint;
    if (!parser.ReadUntil(Tokenizer::Token::Whitespace(), fingerprint) ||
        fingerprint.Length() == 0) {
      continue;
    }

    AddEntryToList(host, port, attributes,
                   false,  // not temporary
                   fingerprint, aProofOfLock);
  }

  return NS_OK;
}

nsresult nsCertOverrideService::Write(const MutexAutoLock& aProofOfLock) {
  mMutex.AssertCurrentThreadOwns();
  MOZ_ASSERT(NS_IsMainThread());
  if (!NS_IsMainThread()) {
    return NS_ERROR_NOT_SAME_THREAD;
  }

  // If we don't have any profile, then we won't try to write any file
  if (!mSettingsFile) {
    return NS_OK;
  }

  nsCString output;

  static const char kHeader[] =
      "# PSM Certificate Override Settings file" NS_LINEBREAK
      "# This is a generated file!  Do not edit." NS_LINEBREAK;

  /* see ::Read for file format */

  output.Append(kHeader);

  static const char kTab[] = "\t";
  for (auto iter = mSettingsTable.Iter(); !iter.Done(); iter.Next()) {
    nsCertOverrideEntry* entry = iter.Get();

    RefPtr<nsCertOverride> settings = entry->mSettings;
    if (settings->mIsTemporary) {
      continue;
    }

    output.Append(entry->mKeyString);
    output.Append(kTab);
    output.Append(sSHA256OIDString);
    output.Append(kTab);
    output.Append(settings->mFingerprint);
    output.Append(kTab);
    // the "bits" string used to go here, but it no longer exists
    // the "\t dbKey" string used to go here, but it no longer exists
    output.Append(NS_LINEBREAK);
  }

  // Make a clone of the file to pass to the WriterRunnable.
  nsCOMPtr<nsIFile> file;
  nsresult rv;
  rv = mSettingsFile->Clone(getter_AddRefs(file));
  NS_ENSURE_SUCCESS(rv, rv);

  nsCOMPtr<nsIRunnable> runnable = new WriterRunnable(this, output, file);
  rv = mWriterTaskQueue->Dispatch(runnable.forget());
  if (NS_FAILED(rv)) {
    return rv;
  }
  mPendingWriteCount++;

  if (mPendingWriteCount == 1) {
    rv = GetShutdownBarrier()->AddBlocker(
        this, NS_LITERAL_STRING_FROM_CSTRING(__FILE__), __LINE__,
        u"nsCertOverrideService writing data"_ns);
    NS_ENSURE_SUCCESS(rv, rv);
  }

  return NS_OK;
}

nsresult GetCertSha256Fingerprint(nsIX509Cert* aCert, nsCString& aResult) {
  nsAutoString fpStrUTF16;
  nsresult rv = aCert->GetSha256Fingerprint(fpStrUTF16);
  if (NS_FAILED(rv)) {
    return rv;
  }
  aResult.Assign(NS_ConvertUTF16toUTF8(fpStrUTF16));
  return NS_OK;
}

NS_IMETHODIMP
nsCertOverrideService::RememberValidityOverride(
    const nsACString& aHostName, int32_t aPort,
    const OriginAttributes& aOriginAttributes, nsIX509Cert* aCert,
    bool aTemporary) {
  if (aHostName.IsEmpty() || !IsAscii(aHostName) || !aCert) {
    return NS_ERROR_INVALID_ARG;
  }
  if (aPort < -1) {
    return NS_ERROR_INVALID_ARG;
  }
  if (!NS_IsMainThread()) {
    return NS_ERROR_NOT_SAME_THREAD;
  }

  nsAutoCString fpStr;
  nsresult rv = GetCertSha256Fingerprint(aCert, fpStr);
  if (NS_FAILED(rv)) {
    return rv;
  }

  {
    MutexAutoLock lock(mMutex);
    AddEntryToList(aHostName, aPort, aOriginAttributes, aTemporary, fpStr,
                   lock);
    if (!aTemporary) {
      Write(lock);
    }
  }

  return NS_OK;
}

NS_IMETHODIMP
nsCertOverrideService::RememberValidityOverrideScriptable(
    const nsACString& aHostName, int32_t aPort,
    JS::Handle<JS::Value> aOriginAttributes, nsIX509Cert* aCert,
    bool aTemporary, JSContext* aCx) {
  OriginAttributes attrs;
  if (!aOriginAttributes.isObject() || !attrs.Init(aCx, aOriginAttributes)) {
    return NS_ERROR_INVALID_ARG;
  }

  return RememberValidityOverride(aHostName, aPort, attrs, aCert, aTemporary);
}

NS_IMETHODIMP
nsCertOverrideService::HasMatchingOverride(
    const nsACString& aHostName, int32_t aPort,
    const OriginAttributes& aOriginAttributes, nsIX509Cert* aCert,
    bool* aIsTemporary, bool* aRetval) {
  bool disableAllSecurityCheck = false;
  {
    MutexAutoLock lock(mMutex);
    if (mUserContextIdsWithSecurityChecksOverride.has(
            aOriginAttributes.mUserContextId)) {
      auto p = mUserContextIdsWithSecurityChecksOverride.lookup(
          aOriginAttributes.mUserContextId);
      disableAllSecurityCheck = p->value();
    } else {
      disableAllSecurityCheck = mDisableAllSecurityCheck;
    }
  }
  if (disableAllSecurityCheck) {
    *aIsTemporary = false;
    *aRetval = true;
    return NS_OK;
  }

  if (aHostName.IsEmpty() || !IsAscii(aHostName)) {
    return NS_ERROR_INVALID_ARG;
  }
  if (aPort < -1) return NS_ERROR_INVALID_ARG;

  NS_ENSURE_ARG_POINTER(aCert);
  NS_ENSURE_ARG_POINTER(aIsTemporary);
  NS_ENSURE_ARG_POINTER(aRetval);
  *aRetval = false;

  RefPtr<nsCertOverride> settings(
      GetOverrideFor(aHostName, aPort, aOriginAttributes));
  // If there is no corresponding override and the given OriginAttributes isn't
  // the default, try to look up an override using the default OriginAttributes.
  if (!settings && aOriginAttributes != OriginAttributes()) {
    settings = GetOverrideFor(aHostName, aPort, OriginAttributes());
  }
  if (!settings) {
    return NS_OK;
  }

  *aIsTemporary = settings->mIsTemporary;

  nsAutoCString fpStr;
  nsresult rv = GetCertSha256Fingerprint(aCert, fpStr);
  if (NS_FAILED(rv)) {
    return rv;
  }

  *aRetval = settings->mFingerprint.Equals(fpStr);
  return NS_OK;
}

already_AddRefed<nsCertOverride> nsCertOverrideService::GetOverrideFor(
    const nsACString& aHostName, int32_t aPort,
    const OriginAttributes& aOriginAttributes) {
  nsAutoCString keyString;
  GetKeyString(aHostName, aPort, aOriginAttributes, keyString);
  MutexAutoLock lock(mMutex);
  nsCertOverrideEntry* entry = mSettingsTable.GetEntry(keyString.get());
  if (!entry) {
    return nullptr;
  }
  return do_AddRef(entry->mSettings);
}

NS_IMETHODIMP
nsCertOverrideService::HasMatchingOverrideScriptable(
    const nsACString& aHostName, int32_t aPort,
    JS::Handle<JS::Value> aOriginAttributes, nsIX509Cert* aCert,
    bool* aIsTemporary, JSContext* aCx, bool* aRetval) {
  OriginAttributes attrs;
  if (!aOriginAttributes.isObject() || !attrs.Init(aCx, aOriginAttributes)) {
    return NS_ERROR_INVALID_ARG;
  }

  return HasMatchingOverride(aHostName, aPort, attrs, aCert, aIsTemporary,
                             aRetval);
}

nsresult nsCertOverrideService::AddEntryToList(
    const nsACString& aHostName, int32_t aPort,
    const OriginAttributes& aOriginAttributes, const bool aIsTemporary,
    const nsACString& fingerprint, const MutexAutoLock& aProofOfLock) {
  mMutex.AssertCurrentThreadOwns();
  nsAutoCString keyString;
  GetKeyString(aHostName, aPort, aOriginAttributes, keyString);

  nsCertOverrideEntry* entry = mSettingsTable.PutEntry(keyString.get());

  if (!entry) {
    NS_ERROR("can't insert a null entry!");
    return NS_ERROR_OUT_OF_MEMORY;
  }

  entry->mKeyString = keyString;

  RefPtr<nsCertOverride> settings(new nsCertOverride());

  settings->mAsciiHost = aHostName;
  settings->mPort = aPort;
  settings->mOriginAttributes = aOriginAttributes;
  settings->mIsTemporary = aIsTemporary;
  settings->mFingerprint = fingerprint;
  entry->mSettings = settings;

  return NS_OK;
}

NS_IMETHODIMP
nsCertOverrideService::ClearValidityOverride(
    const nsACString& aHostName, int32_t aPort,
    const OriginAttributes& aOriginAttributes) {
  if (aHostName.IsEmpty() || !IsAscii(aHostName)) {
    return NS_ERROR_INVALID_ARG;
  }
  if (!NS_IsMainThread()) {
    return NS_ERROR_NOT_SAME_THREAD;
  }

  if (aPort == 0 && aHostName.EqualsLiteral("all:temporary-certificates")) {
    RemoveAllTemporaryOverrides();
    return NS_OK;
  }
  nsAutoCString keyString;
  GetKeyString(aHostName, aPort, aOriginAttributes, keyString);
  {
    MutexAutoLock lock(mMutex);
    mSettingsTable.RemoveEntry(keyString.get());
    Write(lock);
  }

  nsCOMPtr<nsINSSComponent> nss(do_GetService(PSM_COMPONENT_CONTRACTID));
  if (nss) {
    nss->ClearSSLExternalAndInternalSessionCache();
  } else {
    return NS_ERROR_NOT_AVAILABLE;
  }

  nsCOMPtr<nsIObserverService> os = mozilla::services::GetObserverService();
  if (os) {
    os->NotifyObservers(nullptr, "net:cancel-all-connections", nullptr);
  }

  return NS_OK;
}
NS_IMETHODIMP
nsCertOverrideService::ClearValidityOverrideScriptable(
    const nsACString& aHostName, int32_t aPort,
    JS::Handle<JS::Value> aOriginAttributes, JSContext* aCx) {
  OriginAttributes attrs;
  if (!aOriginAttributes.isObject() || !attrs.Init(aCx, aOriginAttributes)) {
    return NS_ERROR_INVALID_ARG;
  }

  return ClearValidityOverride(aHostName, aPort, attrs);
}

NS_IMETHODIMP
nsCertOverrideService::ClearAllOverrides() {
  if (!NS_IsMainThread()) {
    return NS_ERROR_NOT_SAME_THREAD;
  }

  {
    MutexAutoLock lock(mMutex);
    mSettingsTable.Clear();
    Write(lock);
  }

  nsCOMPtr<nsINSSComponent> nss(do_GetService(PSM_COMPONENT_CONTRACTID));
  if (nss) {
    nss->ClearSSLExternalAndInternalSessionCache();
  } else {
    return NS_ERROR_NOT_AVAILABLE;
  }

  nsCOMPtr<nsIObserverService> os = mozilla::services::GetObserverService();
  if (os) {
    os->NotifyObservers(nullptr, "net:cancel-all-connections", nullptr);
  }

  return NS_OK;
}

void nsCertOverrideService::CountPermanentOverrideTelemetry(
    const MutexAutoLock& aProofOfLock) {
  mMutex.AssertCurrentThreadOwns();
  uint32_t overrideCount = 0;
  for (auto iter = mSettingsTable.Iter(); !iter.Done(); iter.Next()) {
    if (!iter.Get()->mSettings->mIsTemporary) {
      overrideCount++;
    }
  }
  glean::ssl::permanent_cert_error_overrides.AccumulateSingleSample(
      overrideCount);
}

static bool IsDebugger() {
#ifdef ENABLE_WEBDRIVER
  nsCOMPtr<nsIMarionette> marionette = do_GetService(NS_MARIONETTE_CONTRACTID);
  if (marionette) {
    bool marionetteRunning = false;
    marionette->GetRunning(&marionetteRunning);
    if (marionetteRunning) {
      return true;
    }
  }

  nsCOMPtr<nsIRemoteAgent> agent = do_GetService(NS_REMOTEAGENT_CONTRACTID);
  if (agent) {
    bool remoteAgentRunning = false;
    agent->GetRunning(&remoteAgentRunning);
    if (remoteAgentRunning) {
      return true;
    }
  }
#endif

  return false;
}

NS_IMETHODIMP
nsCertOverrideService::
    SetDisableAllSecurityChecksAndLetAttackersInterceptMyData(bool aDisable) {
  if (!(PR_GetEnv("XPCSHELL_TEST_PROFILE_DIR") || IsDebugger())) {
    return NS_ERROR_NOT_AVAILABLE;
  }

  {
    MutexAutoLock lock(mMutex);
    mDisableAllSecurityCheck = aDisable;
  }

  nsCOMPtr<nsINSSComponent> nss(do_GetService(PSM_COMPONENT_CONTRACTID));
  if (nss) {
    nss->ClearSSLExternalAndInternalSessionCache();
  } else {
    return NS_ERROR_NOT_AVAILABLE;
  }

  return NS_OK;
}

NS_IMETHODIMP
nsCertOverrideService::
    SetDisableAllSecurityChecksAndLetAttackersInterceptMyDataForUserContext(
        uint32_t aUserContextId, bool aDisable) {
  if (!(PR_GetEnv("XPCSHELL_TEST_PROFILE_DIR") || IsDebugger())) {
    return NS_ERROR_NOT_AVAILABLE;
  }

  {
    MutexAutoLock lock(mMutex);
    (void)mUserContextIdsWithSecurityChecksOverride.put(aUserContextId,
                                                        aDisable);
  }

  return NS_OK;
}

NS_IMETHODIMP
nsCertOverrideService::
    ResetDisableAllSecurityChecksAndLetAttackersInterceptMyDataForUserContext(
        uint32_t aUserContextId) {
  if (!(PR_GetEnv("XPCSHELL_TEST_PROFILE_DIR") || IsDebugger())) {
    return NS_ERROR_NOT_AVAILABLE;
  }

  {
    MutexAutoLock lock(mMutex);
    mUserContextIdsWithSecurityChecksOverride.remove(aUserContextId);
  }

  return NS_OK;
}

NS_IMETHODIMP
nsCertOverrideService::GetSecurityCheckDisabled(bool* aDisabled) {
  MutexAutoLock lock(mMutex);
  *aDisabled = mDisableAllSecurityCheck;
  return NS_OK;
}

NS_IMETHODIMP
nsCertOverrideService::GetOverrides(
    /*out*/ nsTArray<RefPtr<nsICertOverride>>& retval) {
  MutexAutoLock lock(mMutex);
  for (auto iter = mSettingsTable.Iter(); !iter.Done(); iter.Next()) {
    const RefPtr<nsICertOverride> settings = iter.Get()->mSettings;

    retval.AppendElement(settings);
  }
  return NS_OK;
}

void nsCertOverrideService::GetHostWithPort(const nsACString& aHostName,
                                            int32_t aPort,
                                            nsACString& aRetval) {
  nsAutoCString hostPort;
  if (aHostName.Contains(':')) {
    // if aHostName is an IPv6 address, add brackets to match the internal
    // representation, which always stores IPv6 addresses with brackets
    hostPort.Append('[');
    hostPort.Append(aHostName);
    hostPort.Append(']');
  } else {
    hostPort.Append(aHostName);
  }
  if (aPort == -1) {
    aPort = 443;
  }
  if (!hostPort.IsEmpty()) {
    hostPort.Append(':');
    hostPort.AppendInt(aPort);
  }
  aRetval.Assign(hostPort);
}

void nsCertOverrideService::GetKeyString(
    const nsACString& aHostName, int32_t aPort,
    const OriginAttributes& aOriginAttributes, nsACString& aRetval) {
  nsAutoCString keyString;
  GetHostWithPort(aHostName, aPort, keyString);
  keyString.Append(':');
  OriginAttributes strippedAttributes(aOriginAttributes);
  strippedAttributes.StripAttributes(
      ~OriginAttributes::STRIP_PRIVATE_BROWSING_ID);
  nsAutoCString attributeSuffix;
  strippedAttributes.CreateSuffix(attributeSuffix);
  keyString.Append(attributeSuffix);
  aRetval.Assign(keyString);
}

// nsIAsyncShutdownBlocker implementation
NS_IMETHODIMP
nsCertOverrideService::GetName(nsAString& aName) {
  aName = u"nsCertOverrideService: shutdown"_ns;
  return NS_OK;
}

NS_IMETHODIMP
nsCertOverrideService::GetState(nsIPropertyBag** aState) {
  if (!aState) {
    return NS_ERROR_INVALID_ARG;
  }
  *aState = nullptr;
  return NS_OK;
}

NS_IMETHODIMP
nsCertOverrideService::BlockShutdown(nsIAsyncShutdownClient*) { return NS_OK; }

void nsCertOverrideService::RemoveShutdownBlocker() {
  MOZ_ASSERT(NS_IsMainThread());
  MOZ_ASSERT(mPendingWriteCount > 0);
  mPendingWriteCount--;
  if (mPendingWriteCount == 0) {
    nsresult rv = GetShutdownBarrier()->RemoveBlocker(this);
    MOZ_RELEASE_ASSERT(NS_SUCCEEDED(rv));
  }
}

static bool IsV3OnionIdentity(const nsACString& host) {
  if (host.Length() != 62 || !StringEndsWith(host, ".onion"_ns)) return false;
  for (size_t i = 0; i < 56; ++i) {
    const char c = host[i];
    if (!((c >= 'a' && c <= 'z') || (c >= '2' && c <= '7'))) return false;
  }
  return true;
}

static bool IsAgentScope(const nsACString& host, const OriginAttributes& attrs) {
  const bool protectedContext =
      (attrs.mUserContextId >= 0xB4500000 && attrs.mUserContextId <= 0xB450FFFF) ||
      StringBeginsWith(attrs.mGeckoViewSessionContextId,
                       u"gvctx626173686b697474656e2d6167656e742d"_ns);
  return protectedContext &&
      (host.EqualsLiteral("127.0.0.1") || IsV3OnionIdentity(host));
}

static void ClearAgentTLSConnections() {
  nsCOMPtr<nsINSSComponent> nss(do_GetService(PSM_COMPONENT_CONTRACTID));
  if (nss) nss->ClearSSLExternalAndInternalSessionCache();
  nsCOMPtr<nsIObserverService> observers = mozilla::services::GetObserverService();
  if (observers) observers->NotifyObservers(nullptr, "net:cancel-all-connections", nullptr);
}

NS_IMETHODIMP nsCertOverrideService::SetAgentCA(
    const nsACString& host, JS::Handle<JS::Value> originAttributes,
    nsIX509Cert* ca, JSContext* cx) {
  if (!NS_IsMainThread()) return NS_ERROR_NOT_SAME_THREAD;
  OriginAttributes attrs;
  if (!ca || !originAttributes.isObject() || !attrs.Init(cx, originAttributes) ||
      !IsAgentScope(host, attrs)) return NS_ERROR_INVALID_ARG;
  UniqueCERTCertificate cert(ca->GetCert());
  if (!cert || !CERT_IsCACert(cert.get(), nullptr)) return NS_ERROR_INVALID_ARG;
  nsTArray<uint8_t> root;
  nsresult rv = ca->GetRawDER(root);
  if (NS_FAILED(rv) || root.Length() > 65536) return NS_ERROR_INVALID_ARG;
  auto previous = GetAgentRoot(host, attrs);
  if (previous && previous.ref() == root) return NS_OK;
  SetAgentRoot(host, attrs, root);
  ClearAgentTLSConnections();
  return NS_OK;
}

NS_IMETHODIMP nsCertOverrideService::ClearAgentCA(
    const nsACString& host, JS::Handle<JS::Value> originAttributes, JSContext* cx) {
  if (!NS_IsMainThread()) return NS_ERROR_NOT_SAME_THREAD;
  OriginAttributes attrs;
  if (!originAttributes.isObject() || !attrs.Init(cx, originAttributes) ||
      !IsAgentScope(host, attrs)) return NS_ERROR_INVALID_ARG;
  SetAgentRoot(host, attrs, nsTArray<uint8_t>());
  ClearAgentTLSConnections();
  return NS_OK;
}

NS_IMETHODIMP nsCertOverrideService::SetAgentOnionEnrollment(
    const nsACString& host, JS::Handle<JS::Value> originAttributes,
    bool enabled, JSContext* cx) {
  if (!NS_IsMainThread()) return NS_ERROR_NOT_SAME_THREAD;
  OriginAttributes attrs;
  if (!originAttributes.isObject() || !attrs.Init(cx, originAttributes) ||
      !IsAgentScope(host, attrs) || !IsV3OnionIdentity(host) ||
      GetAgentRoot(host, attrs).isSome()) return NS_ERROR_INVALID_ARG;
  mozilla::psm::SetAgentOnionEnrollment(host, attrs, enabled);
  ClearAgentTLSConnections();
  return NS_OK;
}

NS_IMETHODIMP nsCertOverrideService::SetAuthenticatedOnion(
    const nsAString& sessionContext, const nsACString& identity, bool enabled) {
  if (sessionContext.IsEmpty() || sessionContext.Length() > 256 ||
      sessionContext.FindChar('|') != kNotFound || !IsV3OnionIdentity(identity)) {
    return NS_ERROR_INVALID_ARG;
  }
  if (!NS_IsMainThread()) return NS_ERROR_NOT_SAME_THREAD;
  nsAutoCString key{NS_ConvertUTF16toUTF8(sessionContext)};
  key.Append('|');
  key.Append(identity);
  bool removed = false;
  {
    MutexAutoLock lock(mMutex);
    if (enabled) mAuthenticatedOnions.Insert(key);
    else {
      removed = mAuthenticatedOnions.Contains(key);
      mAuthenticatedOnions.Remove(key);
    }
  }
  if (removed) {
    nsCOMPtr<nsINSSComponent> nss(do_GetService(PSM_COMPONENT_CONTRACTID));
    if (nss) nss->ClearSSLExternalAndInternalSessionCache();
    nsCOMPtr<nsIObserverService> observers = mozilla::services::GetObserverService();
    if (observers) observers->NotifyObservers(nullptr, "net:cancel-all-connections", nullptr);
  }
  return NS_OK;
}

NS_IMETHODIMP nsCertOverrideService::IsAuthenticatedOnion(
    const nsAString& sessionContext, const nsACString& host, bool* result) {
  *result = false;
  if (sessionContext.IsEmpty() || host.Length() < 62) return NS_OK;
  const nsDependentCSubstring identity = Substring(host, host.Length() - 62);
  if (!IsV3OnionIdentity(identity) ||
      (host.Length() > 62 && host[host.Length() - 63] != '.')) return NS_OK;
  nsAutoCString key{NS_ConvertUTF16toUTF8(sessionContext)};
  key.Append('|');
  key.Append(identity);
  MutexAutoLock lock(mMutex);
  *result = mAuthenticatedOnions.Contains(key);
  return NS_OK;
}
