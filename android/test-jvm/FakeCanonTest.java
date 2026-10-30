package my.photobooth.booth;

import java.io.IOException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Tests the Canon code against a pretend Canon EOS that speaks PTP at the USB-packet level.
 * Run: android/test-jvm/run.sh
 */
public class FakeCanonTest {

    /** A pretend Canon EOS 750D on the other end of the USB cable. */
    static final class FakeCanon implements UsbLink {
        final int maxTransfer;
        final ArrayDeque<byte[]> outgoing = new ArrayDeque<>();   // whole USB transfers waiting to be read
        byte[] partial; int partialOff;
        int pendingDataOp = -1, pendingTid; int[] pendingParams;
        boolean session = false, stalled = false;
        int evfOut = 1, evfMode = 0, dest = 2, shots = 0;
        final List<int[]> events = new ArrayList<>();
        int lvCalls = 0, lvNotReady = 3, stallAtLv = -1, recovers = 0, closeSessionCalls = 0;
        int photoSize; byte[] photo; boolean photoReady = false; int releases = 0;
        boolean failFullPress = false;
        final List<String> ops = new ArrayList<>();

        FakeCanon(int maxTransfer, int photoSize) {
            this.maxTransfer = maxTransfer; this.photoSize = photoSize;
            photo = new byte[photoSize];
            for (int i = 0; i < photoSize; i++) photo[i] = (byte) (i * 31 + 7);
            photo[0] = (byte) 0xFF; photo[1] = (byte) 0xD8;
            prop(0xD1B0, evfOut); prop(0xD1B1, evfMode); prop(0xD11C, dest); prop(0xD11B, shots);
        }

        void prop(int code, int v) { events.add(new int[]{0xC189, code, v}); }

        public int maxPacket() { return 512; }
        public int maxTransfer() { return maxTransfer; }

        public synchronized int write(byte[] data, int len, int timeoutMs) {
            if (stalled) return -1;
            if (len == 0) return 0;
            if (len > maxTransfer) throw new AssertionError("write larger than maxTransfer");
            int clen = Ptp.get32(data, 0), type = Ptp.get16(data, 4), code = Ptp.get16(data, 6), tid = Ptp.get32(data, 8);
            if (type == 1) {
                int[] p = new int[(clen - 12) / 4];
                for (int i = 0; i < p.length; i++) p[i] = Ptp.get32(data, 12 + 4 * i);
                if (code == 0x9110) { pendingDataOp = code; pendingTid = tid; pendingParams = p; return len; }
                handle(code, tid, p, null);
            } else if (type == 2) {
                if (pendingDataOp != code) throw new AssertionError("data for wrong op");
                handle(code, pendingTid, pendingParams, Arrays.copyOfRange(data, 12, clen));
                pendingDataOp = -1;
            }
            return len;
        }

        public synchronized int read(byte[] buf, int len, int timeoutMs) {
            if (stalled) return -1;
            if (glitches > 0 && !outgoing.isEmpty() && !lastGlitch) { glitches--; lastGlitch = true; return -1; }
            lastGlitch = false;
            if (len > maxTransfer) throw new AssertionError("read larger than maxTransfer: " + len);
            if (len % 512 != 0) throw new AssertionError("read not a multiple of the packet size: " + len);
            if (partial == null) {
                if (outgoing.isEmpty()) return -1;   // timeout
                partial = outgoing.poll(); partialOff = 0;
                if (partial.length == 0) { partial = null; return 0; }   // zero-length packet
            }
            int n = Math.min(len, partial.length - partialOff);
            System.arraycopy(partial, partialOff, buf, 0, n);
            partialOff += n;
            if (partialOff >= partial.length) {
                boolean exact = partial.length % 512 == 0;
                partial = null;
                if (exact) outgoing.add(new byte[0]);   // the camera ends an exact-size transfer with an empty packet
                // move the ZLP to the front so it comes right after this transfer
                if (exact) { byte[] z = outgoing.pollLast(); outgoing.addFirst(z); }
            }
            return n;
        }

        boolean lastGlitch = false;
        int glitches = 0;   // reads that fail once but lose nothing (flaky USB chip)
        public synchronized void recover(boolean hard) {
            recovers++; stalled = false; outgoing.clear(); partial = null; pendingDataOp = -1;
            if (hard) session = false;
        }

        void respond(int code, int tid, int... params) {
            byte[] b = new byte[12 + 4 * params.length];
            Ptp.header(b, b.length, 3, code, tid);
            for (int i = 0; i < params.length; i++) Ptp.put32(b, 12 + 4 * i, params[i]);
            outgoing.add(b);
        }

        void data(int op, int tid, byte[] payload) {
            byte[] b = new byte[12 + payload.length];
            Ptp.header(b, b.length, 2, op, tid);
            System.arraycopy(payload, 0, b, 12, payload.length);
            outgoing.add(b);
        }

        void handle(int op, int tid, int[] p, byte[] dataIn) {
            ops.add(Ptp.hex(op));
            if (op != 0x1001 && op != 0x1002 && !session) { respond(0x2003, tid); return; }
            switch (op) {
                case 0x1001: data(op, tid, deviceInfo()); respond(0x2001, tid); break;
                case 0x1002:
                    if (tid != 0) throw new AssertionError("OpenSession must use transaction 0, got " + tid);
                    if (session) { respond(0x201E, tid); break; }
                    session = true; respond(0x2001, tid); break;
                case 0x1003: closeSessionCalls++; session = false; respond(0x2001, tid); break;
                case 0x9114: case 0x9115: case 0x913D: case 0x911D: respond(0x2001, tid); break;
                case 0x911A: shots = 500; prop(0xD11B, shots); respond(0x2001, tid); break;
                case 0x9116: {
                    int size = 8;
                    for (int[] e : events) size += e[0] == 0xC186 ? 0x24 : 16;
                    byte[] d = new byte[size]; int pos = 0;
                    for (int[] e : events) {
                        if (e[0] == 0xC186) {
                            Ptp.put32(d, pos, 0x24); Ptp.put32(d, pos + 4, 0xC186); Ptp.put32(d, pos + 8, e[1]);
                            Ptp.put16(d, pos + 0x0c, 0x3801); Ptp.put32(d, pos + 0x14, e[2]);
                            byte[] name = "IMG_0001.JPG".getBytes();
                            System.arraycopy(name, 0, d, pos + 0x1c, Math.min(name.length, 0x24 - 0x1c - 1));
                            pos += 0x24;
                        } else {
                            Ptp.put32(d, pos, 16); Ptp.put32(d, pos + 4, e[0]); Ptp.put32(d, pos + 8, e[1]); Ptp.put32(d, pos + 12, e[2]);
                            pos += 16;
                        }
                    }
                    Ptp.put32(d, pos, 8);
                    events.clear();
                    data(op, tid, d); respond(0x2001, tid); break;
                }
                case 0x9110: {
                    int code = Ptp.get32(dataIn, 4), v = Ptp.get32(dataIn, 8);
                    if (Ptp.get32(dataIn, 0) != 12) throw new AssertionError("bad prop size");
                    if (code == 0xD1B0) evfOut = v; else if (code == 0xD1B1) evfMode = v; else if (code == 0xD11C) { dest = v; shots = 0; prop(0xD11B, 0); }
                    prop(code, v);
                    respond(0x2001, tid); break;
                }
                case 0x9153: {
                    lvCalls++;
                    if (stallAtLv == lvCalls) { stalled = true; return; }
                    if ((evfOut & 2) == 0 || lvNotReady-- > 0) { respond(0xA102, tid); break; }
                    byte[] jpg = new byte[5000 + (lvCalls % 7) * 512];   // some frames are exact multiples of 512
                    jpg[0] = (byte) 0xFF; jpg[1] = (byte) 0xD8; jpg[2] = (byte) lvCalls;
                    byte[] d = new byte[8 + jpg.length + 8 + 64];
                    Ptp.put32(d, 0, 8 + jpg.length); Ptp.put32(d, 4, 1); System.arraycopy(jpg, 0, d, 8, jpg.length);
                    Ptp.put32(d, 8 + jpg.length, 72); Ptp.put32(d, 12 + jpg.length, 17);
                    data(op, tid, d); respond(0x2001, tid); break;
                }
                case 0x9128:
                    if (p[0] == 2 && failFullPress) { respond(0xA102, tid); break; }
                    if (p[0] == 2) releases++;
                    respond(0x2001, tid); break;
                case 0x9129:
                    if (p[0] == 2) {
                        if (dest != 4) throw new AssertionError("photo taken without capture destination = PC");
                        events.add(new int[]{0xC186, 0x9001, photoSize}); evfOut = evfOut; lvNotReady = 2;
                    }
                    respond(0x2001, tid); break;
                case 0x101B: {
                    int off = p[1], n = Math.min(p[2], photoSize - off);
                    data(op, tid, Arrays.copyOfRange(photo, off, off + n)); respond(0x2001, tid); break;
                }
                case 0x9117: respond(0x2001, tid); break;
                default: respond(0x2005, tid);
            }
        }

        static byte[] deviceInfo() {
            int[] ops = {0x1001, 0x1002, 0x1003, 0x1008, 0x101B, 0x9110, 0x9114, 0x9115, 0x9116, 0x9117, 0x911A, 0x911D, 0x9128, 0x9129, 0x913D, 0x9151, 0x9153};
            String model = "Canon EOS 750D", maker = "Canon Inc.";
            java.io.ByteArrayOutputStream o = new java.io.ByteArrayOutputStream();
            w16(o, 100); w32(o, 11); w16(o, 100); wstr(o, ""); w16(o, 0);
            w32(o, ops.length); for (int x : ops) w16(o, x);
            for (int k = 0; k < 4; k++) { w32(o, 1); w16(o, 0x4000 + k); }
            wstr(o, maker); wstr(o, model); wstr(o, "1.0"); wstr(o, "123");
            return o.toByteArray();
        }
        static void w16(java.io.ByteArrayOutputStream o, int v) { o.write(v); o.write(v >> 8); }
        static void w32(java.io.ByteArrayOutputStream o, int v) { w16(o, v); w16(o, v >>> 16); }
        static void wstr(java.io.ByteArrayOutputStream o, String s) {
            if (s.isEmpty()) { o.write(0); return; }
            o.write(s.length() + 1); for (char c : s.toCharArray()) w16(o, c); w16(o, 0);
        }
    }

    static final class FakeOpener implements CanonService.Opener {
        final FakeCanon cam; boolean plugged = true; int opens = 0;
        FakeOpener(FakeCanon c) { cam = c; }
        public UsbLink open() throws IOException {
            if (!plugged) throw new CanonService.NoRetry("No Canon found");
            opens++; cam.recover(true); return cam;
        }
        public void close() { }
        public boolean present() { return plugged; }
    }

    static String call(CanonService s, String op) throws Exception {
        AtomicReference<String> r = new AtomicReference<>();
        CountDownLatch l = new CountDownLatch(1);
        s.call(op, json -> { r.set(json); l.countDown(); });
        if (!l.await(40, TimeUnit.SECONDS)) throw new AssertionError(op + " timed out");
        return r.get();
    }

    static int failures = 0;
    static void check(boolean ok, String what) {
        System.out.println((ok ? "  PASS " : "  FAIL ") + what);
        if (!ok) failures++;
    }

    static int idOf(String json) { java.util.regex.Matcher m = java.util.regex.Pattern.compile("\"id\":(\\d+)").matcher(json); return m.find() ? Integer.parseInt(m.group(1)) : -1; }

    static void scenario(String name, int maxTransfer, int photoSize) throws Exception {
        System.out.println("== " + name + " (transfer " + maxTransfer + ", photo " + photoSize + " bytes)");
        FakeCanon cam = new FakeCanon(maxTransfer, photoSize);
        FakeOpener opener = new FakeOpener(cam);
        CanonService s = new CanonService(opener);

        String r = call(s, "connect");
        check(r.contains("\"ok\":true") && r.contains("750D"), "connect: " + r);
        check(cam.dest == 4, "photos go to the tablet (capture destination = 4)");
        check(cam.shots > 0, "camera told there is free space");

        r = call(s, "liveOn");
        check(r.contains("\"ok\":true"), "live view on: " + r);
        long[] seq = {0};
        long after = 0; int got = 0; long t0 = System.currentTimeMillis();
        for (int i = 0; i < 20; i++) {
            byte[] f = s.waitFrame(after, 3000, seq);
            if (f != null && (f[0] & 0xff) == 0xFF && (f[1] & 0xff) == 0xD8) { got++; after = seq[0]; }
        }
        check(got == 20, "20 live view frames (" + got + ") in " + (System.currentTimeMillis() - t0) + " ms");
        check(cam.evfOut == 2 && cam.evfMode == 1, "live view sent to the tablet");

        r = call(s, "capture");
        int id = idOf(r);
        byte[] photo = s.takePhoto(id);
        check(r.contains("\"ok\":true") && photo != null && Arrays.equals(photo, cam.photo), "photo downloaded intact: " + r);
        check(cam.ops.contains("0x9117"), "transfer complete sent");

        got = 0;
        for (int i = 0; i < 5; i++) { byte[] f = s.waitFrame(after, 4000, seq); if (f != null) { got++; after = seq[0]; } }
        check(got == 5, "live view resumes after the photo (" + got + "/5)");

        // USB stall in the middle of live view: the service must recover by itself
        cam.stallAtLv = cam.lvCalls + 3;
        got = 0; int recBefore = cam.recovers;
        for (int i = 0; i < 10; i++) { byte[] f = s.waitFrame(after, 6000, seq); if (f != null) { got++; after = seq[0]; } }
        check(cam.recovers > recBefore && got == 10, "recovers from a USB stall and live view continues (" + got + "/10, resets " + (cam.recovers - recBefore) + ")");

        // Flaky USB chip: single failed reads are retried without losing the live view
        int recBefore2 = cam.recovers;
        cam.glitches = 6;
        got = 0;
        for (int i = 0; i < 10; i++) { byte[] f = s.waitFrame(after, 6000, seq); if (f != null) { got++; after = seq[0]; } }
        check(got == 10 && cam.recovers == recBefore2 && s.status().contains("\"usbRetries\":6"), "flaky reads retried, no reconnect needed (" + got + "/10, " + s.status() + ")");

        // Focus failure: clear message, camera still usable
        cam.failFullPress = true;
        r = call(s, "capture");
        check(r.contains("\"ok\":false") && r.contains("focus"), "focus failure reported: " + r);
        cam.failFullPress = false;
        r = call(s, "capture");
        check(r.contains("\"ok\":true"), "next photo works after a focus failure");

        // Reconnect (page reload) reuses the healthy connection
        int opens = opener.opens;
        r = call(s, "connect");
        check(r.contains("\"ok\":true") && opener.opens == opens, "connect again reuses the open connection");

        // Unplugged
        s.detached();
        opener.plugged = false;
        r = call(s, "capture");
        check(r.contains("\"ok\":false"), "photo when unplugged gives an error: " + r);
        r = call(s, "connect");
        check(r.contains("\"ok\":false") && r.contains("No Canon"), "connect when unplugged: " + r);
        opener.plugged = true;
        r = call(s, "connect");
        check(r.contains("\"ok\":true"), "connect after plugging back in");
        r = call(s, "liveOn");
        byte[] f = s.waitFrame(after, 5000, seq);
        check(f != null, "live view after plugging back in");
        r = call(s, "disconnect");
        check(r.contains("\"ok\":true") && cam.closeSessionCalls > 0, "disconnect closes the session");
    }

    public static void main(String[] a) throws Exception {
        scenario("Android 10 (large transfers)", 512 * 1024, 2_300_000);
        scenario("small transfers, photo exactly 4 x 1 MB", 16384, 4 * 1024 * 1024);
        scenario("photo size multiple of 512", 512 * 1024, 512 * 3001);
        System.out.println(failures == 0 ? "ALL PASSED" : failures + " FAILED");
        System.exit(failures == 0 ? 0 : 1);
    }
}
