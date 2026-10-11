// SPDX-License-Identifier: AGPL-3.0-only
package com.bashkitten.phone;

import javax.net.ssl.*;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Pins the validated public address for the actual connection, including TLS
 * hostname verification. DNS rebinding cannot reach a private native controller. */
final class PhoneDownload implements AutoCloseable {
    private final Socket socket;final InputStream stream;
    PhoneDownload(String value,Runnable check)throws Exception{
        URI uri=PhoneFiles.publicUrl(value);InetAddress[] addresses=InetAddress.getAllByName(uri.getHost());
        for(InetAddress address:addresses)PhoneFiles.requirePublic(address);
        boolean tls=uri.getScheme().equals("https");int port=uri.getPort()<0?(tls?443:80):uri.getPort();
        Socket connected=new Socket();
        try{
            check.run();connected.connect(new InetSocketAddress(addresses[0],port),10000);connected.setSoTimeout(10000);
            if(tls){SSLSocket secure=(SSLSocket)((SSLSocketFactory)SSLSocketFactory.getDefault()).createSocket(connected,uri.getHost(),port,true);SSLParameters parameters=secure.getSSLParameters();parameters.setEndpointIdentificationAlgorithm("HTTPS");secure.setSSLParameters(parameters);secure.startHandshake();connected=secure;}
            String target=uri.getRawPath();if(target==null||target.isEmpty())target="/";if(uri.getRawQuery()!=null)target+="?"+uri.getRawQuery();
            if(target.indexOf('\r')>=0||target.indexOf('\n')>=0)throw new SecurityException("Invalid download path");
            String host=uri.getHost().contains(":")?"["+uri.getHost()+"]":uri.getHost();if(uri.getPort()>=0)host+=":"+port;
            OutputStream out=connected.getOutputStream();out.write(("GET "+target+" HTTP/1.1\r\nHost: "+host+"\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));out.flush();
            InputStream in=new BufferedInputStream(connected.getInputStream());String status=line(in);if(status==null||!status.matches("HTTP/1\\.[01] 2[0-9][0-9]( .*)?"))throw new IOException("Download failed; redirects are not followed");
            Map<String,String> headers=new HashMap<>();for(String row;(row=line(in))!=null&&!row.isEmpty();){int colon=row.indexOf(':');if(colon<=0)throw new IOException("Invalid download headers");String key=row.substring(0,colon).toLowerCase(Locale.ROOT);if(headers.put(key,row.substring(colon+1).trim())!=null&&Set.of("content-length","transfer-encoding").contains(key))throw new IOException("Ambiguous download framing");}
            String transfer=headers.get("transfer-encoding");
            if(transfer!=null&&!transfer.equalsIgnoreCase("chunked"))throw new IOException("Unsupported download framing");
            stream=transfer!=null?new Chunked(in):headers.containsKey("content-length")?new PhoneControlsRuntime.LimitedInput(in,Long.parseLong(headers.get("content-length"))):in;
            socket=connected;check.run();
        }catch(Exception error){connected.close();throw error;}
    }
    public void close()throws IOException{socket.close();}
    private static String line(InputStream in)throws IOException{ByteArrayOutputStream bytes=new ByteArrayOutputStream();int next;while((next=in.read())!=-1){if(next=='\n')break;if(next!='\r')bytes.write(next);if(bytes.size()>65536)throw new IOException("Invalid download header");}return next==-1&&bytes.size()==0?null:bytes.toString(StandardCharsets.US_ASCII);}
    private static final class Chunked extends InputStream{
        final InputStream in;long remaining=0;boolean end=false,first=true;
        Chunked(InputStream in){this.in=in;}
        private void chunk()throws IOException{if(remaining>0||end)return;if(!first&&!"".equals(line(in)))throw new IOException("Invalid chunk end");first=false;String header=line(in);if(header==null)throw new EOFException();try{remaining=Long.parseLong(header.split(";",2)[0].trim(),16);}catch(NumberFormatException error){throw new IOException("Invalid chunk size");}if(remaining<0)throw new IOException("Invalid chunk size");end=remaining==0;}
        public int read()throws IOException{byte[] b=new byte[1];int n=read(b,0,1);return n<0?-1:b[0]&255;}
        public int read(byte[] b,int offset,int length)throws IOException{chunk();if(end)return -1;int count=in.read(b,offset,(int)Math.min(length,remaining));if(count<0)throw new EOFException();remaining-=count;return count;}
    }
}
