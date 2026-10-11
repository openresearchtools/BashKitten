// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten.phone;

import android.os.SystemClock;
import org.json.JSONObject;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

/** Issuing authority remains in the native controller and trusted backend owner. */
final class PhoneGrantRegistry {
    static final long LEASE_MS = 60_000;
    static final class Grant {
        final String token, worker, session, incarnation; final long generation; long expires;
        Grant(String worker, String session, String incarnation, long generation) {
            this.worker=worker; this.session=session; this.incarnation=incarnation; this.generation=generation;
            token=random(); expires=SystemClock.elapsedRealtime()+LEASE_MS;
        }
    }
    private final Map<String, Grant> grants = new HashMap<>();
    private final PhonePolicy policy;
    PhoneGrantRegistry(PhonePolicy policy) { this.policy=policy; }
    static String random() { byte[] bytes=new byte[32]; new SecureRandom().nextBytes(bytes); return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); }
    synchronized JSONObject issue(JSONObject request) throws Exception {
        if (!policy.master()) throw new SecurityException("Phone controls are Off");
        String worker=id(request,"worker"), session=id(request,"session"), incarnation=id(request,"incarnation");
        for(Grant existing:grants.values()) if(existing.worker.equals(worker)&&existing.session.equals(session)&&existing.incarnation.equals(incarnation)&&existing.generation==policy.generation()&&existing.expires>SystemClock.elapsedRealtime()) { existing.expires=SystemClock.elapsedRealtime()+LEASE_MS;
            return new JSONObject().put("grant",existing.token).put("session",session).put("expiresInMs",existing.expires-SystemClock.elapsedRealtime()); }
        revoke(worker);
        Grant grant = new Grant(worker,session,incarnation,policy.generation()); grants.put(grant.token,grant);
        return new JSONObject().put("grant",grant.token).put("session",session).put("expiresInMs",LEASE_MS);
    }
    synchronized Grant require(String token) {
        Grant g=grants.get(token);
        if (g==null || !policy.master() || g.generation!=policy.generation() || g.expires<=SystemClock.elapsedRealtime()) {
            grants.remove(token); throw new SecurityException("Phone worker authorization expired or was revoked");
        }
        return g;
    }
    synchronized void check(Grant grant) { if (require(grant.token)!=grant) throw new SecurityException("Phone worker changed"); }
    synchronized void revoke(String worker) { grants.values().removeIf(g -> g.worker.equals(worker) || g.expires<=SystemClock.elapsedRealtime()); }
    synchronized void clear() { grants.clear(); }
    private static String id(JSONObject value,String key) throws Exception {
        String id=value.getString(key); if (!id.matches("[A-Za-z0-9_.:-]{1,160}")) throw new IllegalArgumentException("Invalid worker identity"); return id;
    }
}
