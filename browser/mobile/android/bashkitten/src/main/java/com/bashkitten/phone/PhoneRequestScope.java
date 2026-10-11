// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten.phone;
import java.util.*;
final class PhoneRequestScope implements AutoCloseable {
    private final List<AutoCloseable> resources=new ArrayList<>();private boolean closed;
    synchronized <T extends AutoCloseable>T own(T resource)throws Exception{if(resource==null)throw new java.io.FileNotFoundException();if(closed){resource.close();throw new java.util.concurrent.CancellationException();}resources.add(resource);return resource;}
    public synchronized void close(){if(closed)return;closed=true;for(AutoCloseable resource:resources)try{resource.close();}catch(Exception ignored){}resources.clear();}
}
