package my.photobooth.booth;

import java.io.ByteArrayOutputStream;
import java.io.IOException;

/** PTP over USB (the protocol cameras use for remote control): command, optional data, response. */
final class Ptp {
    static final int RC_OK = 0x2001;
    static final int RC_GENERAL_ERROR = 0x2002;
    static final int RC_SESSION_NOT_OPEN = 0x2003;
    static final int RC_DEVICE_BUSY = 0x2019;
    static final int RC_SESSION_ALREADY_OPEN = 0x201E;
    static final int RC_CANON_NOT_READY = 0xA102;

    private static final int TYPE_COMMAND = 1, TYPE_DATA = 2, TYPE_RESPONSE = 3, TYPE_EVENT = 4;

    static final class Result {
        int code;
        int[] params = new int[0];
        byte[] data;
        boolean ok() { return code == RC_OK; }
    }

    /** The USB link failed (cable, power, camera switched off). */
    static final class LinkError extends IOException {
        LinkError(String m) { super(m); }
    }

    private final UsbLink link;
    private final byte[] buf;
    private int tid = 0, curOp = 0;

    Ptp(UsbLink link) {
        this.link = link;
        int size = Math.min(512 * 1024, link.maxTransfer());
        size -= size % link.maxPacket();
        buf = new byte[size];
    }

    UsbLink link() { return link; }

    /** OpenSession must use transaction 0; later commands count up from 1. */
    void resetTransactions() { tid = -1; }

    synchronized Result run(int op, int[] params, byte[] dataOut, int timeoutMs) throws IOException {
        if (params == null) params = new int[0];
        curOp = op;
        int id = ++tid;
        if (tid < 0) tid = 0;

        byte[] cmd = new byte[12 + 4 * params.length];
        header(cmd, cmd.length, TYPE_COMMAND, op, id);
        for (int i = 0; i < params.length; i++) put32(cmd, 12 + 4 * i, params[i]);
        send(cmd, timeoutMs);

        if (dataOut != null) {
            byte[] d = new byte[12 + dataOut.length];
            header(d, d.length, TYPE_DATA, op, id);
            System.arraycopy(dataOut, 0, d, 12, dataOut.length);
            send(d, timeoutMs);
        }

        Result res = new Result();
        for (int guard = 0; guard < 16; guard++) {
            int n = readNonEmpty(timeoutMs);
            if (n < 12) throw new LinkError("short USB packet (" + n + " bytes)");
            int len = get32(buf, 0), type = get16(buf, 4), code = get16(buf, 6);
            if (type == TYPE_DATA) {
                if (len < 12) throw new LinkError("bad data length " + len);
                int total = len - 12;
                ByteArrayOutputStream out = new ByteArrayOutputStream(Math.max(16, total));
                out.write(buf, 12, Math.min(n, len) - 12);
                int got = Math.min(n, len);
                while (got < len) {
                    int want = roundUp(len - got);
                    if (want > buf.length) want = buf.length;
                    long t0 = System.currentTimeMillis();
                    int k = readRetry(want, timeoutMs);
                    if (k < 0) throw new LinkError("USB read failed during data (" + got + "/" + len + ", " + why(t0, timeoutMs) + ", command " + hex(op) + ")");
                    if (k == 0) continue;
                    out.write(buf, 0, Math.min(k, len - got));
                    got += k;
                }
                res.data = out.toByteArray();
                continue;
            }
            if (type == TYPE_RESPONSE) {
                res.code = code;
                int np = Math.max(0, Math.min(5, (Math.min(n, len) - 12) / 4));
                res.params = new int[np];
                for (int i = 0; i < np; i++) res.params[i] = get32(buf, 12 + 4 * i);
                return res;
            }
            if (type == TYPE_EVENT) continue;   // an event on the bulk pipe: not for us
            throw new LinkError("unexpected USB container type " + type);
        }
        throw new LinkError("no response from the camera");
    }

    Result run(int op, int... params) throws IOException { return run(op, params, null, 5000); }

    private void send(byte[] data, int timeoutMs) throws IOException {
        int off = 0;
        while (off < data.length) {
            int chunk = Math.min(data.length - off, link.maxTransfer());
            byte[] part = data;
            if (off != 0 || chunk != data.length) {
                part = new byte[chunk];
                System.arraycopy(data, off, part, 0, chunk);
            }
            long t0 = System.currentTimeMillis();
            int n = link.write(part, chunk, timeoutMs);
            if (n < 0) throw new LinkError("USB write failed (" + why(t0, timeoutMs) + ", command " + hex(curOp) + ")");
            off += n;
            if (n == 0) throw new LinkError("USB write sent nothing");
        }
        // A transfer that is an exact multiple of the packet size needs an empty packet to end it
        if (data.length % link.maxPacket() == 0) link.write(new byte[0], 0, timeoutMs);
    }

    private int readNonEmpty(int timeoutMs) throws IOException {
        for (int i = 0; i < 4; i++) {
            long t0 = System.currentTimeMillis();
            int n = readRetry(buf.length, timeoutMs);
            if (n < 0) throw new LinkError("USB read failed (" + why(t0, timeoutMs) + ", command " + hex(curOp) + ")");
            if (n > 0) return n;
        }
        return 0;
    }

    /** Some tablets' USB chips fail a read now and then: try it again before giving up. */
    private int readRetry(int len, int timeoutMs) {
        int n = -1;
        for (int i = 0; i < 3; i++) {
            long t0 = System.currentTimeMillis();
            n = link.read(buf, len, timeoutMs);
            if (n >= 0) { if (i > 0) retries++; return n; }
            if (System.currentTimeMillis() - t0 >= timeoutMs - 100) return n;   // the camera is silent: retrying won't help
            CanonEos.sleep(5);
        }
        return n;
    }

    /** How many reads only worked on a second try (shown in the camera report). */
    volatile int retries = 0;

    /** A read that fails at once is a broken transfer (cable/hub); one that waits the full time means the camera went silent. */
    private static String why(long t0, int timeoutMs) {
        long ms = System.currentTimeMillis() - t0;
        return (ms >= timeoutMs - 100 ? "camera silent for " : "transfer broke after ") + ms + " ms";
    }

    private int roundUp(int n) {
        int p = link.maxPacket();
        return ((n + p - 1) / p) * p;
    }

    static void header(byte[] b, int len, int type, int code, int id) {
        put32(b, 0, len); put16(b, 4, type); put16(b, 6, code); put32(b, 8, id);
    }
    static void put16(byte[] b, int o, int v) { b[o] = (byte) v; b[o + 1] = (byte) (v >> 8); }
    static void put32(byte[] b, int o, int v) { put16(b, o, v); put16(b, o + 2, v >>> 16); }
    static int get16(byte[] b, int o) { return (b[o] & 0xff) | ((b[o + 1] & 0xff) << 8); }
    static int get32(byte[] b, int o) { return get16(b, o) | (get16(b, o + 2) << 16); }
    static long getU32(byte[] b, int o) { return get32(b, o) & 0xffffffffL; }

    static String hex(int v) { return String.format("0x%04X", v); }
}
