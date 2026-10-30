package my.photobooth.booth;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Canon EOS remote control over PTP: live view frames and photos.
 * The command sequence follows libgphoto2 (camlibs/ptp2), which is what the website used before.
 */
final class CanonEos {
    // Operations
    static final int OC_GetDeviceInfo = 0x1001, OC_OpenSession = 0x1002, OC_CloseSession = 0x1003;
    static final int OC_GetObjectInfo = 0x1008, OC_GetPartialObject = 0x101B;
    static final int OC_RemoteRelease = 0x910F, OC_SetDevicePropValueEx = 0x9110;
    static final int OC_SetRemoteMode = 0x9114, OC_SetEventMode = 0x9115, OC_GetEvent = 0x9116;
    static final int OC_TransferComplete = 0x9117, OC_PCHDDCapacity = 0x911A, OC_KeepDeviceOn = 0x911D;
    static final int OC_RemoteReleaseOn = 0x9128, OC_RemoteReleaseOff = 0x9129;
    static final int OC_SetRequestOLCInfoGroup = 0x913D;
    static final int OC_InitiateViewfinder = 0x9151, OC_GetViewFinderData = 0x9153;
    // Events
    static final int EC_ObjectAddedEx = 0xC181, EC_RequestObjectTransfer = 0xC186, EC_PropValueChanged = 0xC189;
    static final int EC_RequestObjectTransfer64 = 0xC1A9;
    // Properties
    static final int DPC_AvailableShots = 0xD11B, DPC_CaptureDestination = 0xD11C;
    static final int DPC_EVFOutputDevice = 0xD1B0, DPC_EVFMode = 0xD1B1;
    static final int CAPTUREDEST_PC = 4;
    static final int OFC_JPEG = 0x3801;

    interface Log { void log(String s); }

    /** The camera answered, but said no (for example: it could not focus). */
    static final class CamError extends IOException {
        final int code;
        CamError(String m, int code) { super(m); this.code = code; }
    }

    static final class Obj {
        int handle, ofc, storage; long size; String name;
    }

    private final Ptp ptp;
    private final Log log;
    final Set<Integer> ops = new HashSet<>();
    final Map<Integer, Long> props = new HashMap<>();
    private final List<Obj> objects = new ArrayList<>();
    String model = "Canon";
    long lastKeepAlive = 0;
    boolean liveStarted = false;

    CanonEos(Ptp ptp, Log log) { this.ptp = ptp; this.log = log; }

    boolean supports(int op) { return ops.contains(op); }

    int readRetries() { return ptp.retries; }

    /** Opens the session and puts the camera in remote mode. Photos go straight to the tablet, not the SD card. */
    void open() throws IOException {
        Ptp.Result r = ptp.run(OC_GetDeviceInfo, new int[0], null, 5000);
        if (r.ok() && r.data != null) parseDeviceInfo(r.data);
        log.log("camera: " + model + " (" + ops.size() + " commands)");

        ptp.resetTransactions();
        r = ptp.run(OC_OpenSession, 1);
        if (r.code == Ptp.RC_SESSION_ALREADY_OPEN) {
            log.log("session was still open: reopening");
            ptp.run(OC_CloseSession);
            ptp.resetTransactions();
            r = ptp.run(OC_OpenSession, 1);
        }
        if (!r.ok() && r.code != Ptp.RC_SESSION_ALREADY_OPEN) throw new CamError("The Canon refused the connection (" + Ptp.hex(r.code) + ")", r.code);

        check(ptp.run(OC_SetRemoteMode, 1), "remote mode");
        check(ptp.run(OC_SetEventMode, 1), "event mode");
        if (supports(OC_SetRequestOLCInfoGroup)) ptp.run(OC_SetRequestOLCInfoGroup, 0x1fff);
        pollEvents();
        for (int i = 0; i < 10 && !props.containsKey(DPC_EVFOutputDevice); i++) { sleep(50); pollEvents(); }
        captureToTablet();
        pollEvents();
        liveStarted = false;
        lastKeepAlive = System.currentTimeMillis();
    }

    void close() {
        try { if (props.containsKey(DPC_EVFOutputDevice)) setProp(DPC_EVFOutputDevice, 1); } catch (IOException ignored) { }
        try { ptp.run(OC_SetEventMode, 0); } catch (IOException ignored) { }
        try { ptp.run(OC_SetRemoteMode, 0); } catch (IOException ignored) { }
        try { ptp.run(OC_CloseSession); } catch (IOException ignored) { }
        liveStarted = false;
    }

    /** Photos are sent to the tablet's memory (like the website did), so the SD card never fills up. */
    private void captureToTablet() throws IOException {
        Long dest = props.get(DPC_CaptureDestination);
        if (dest == null) { log.log("no capture destination setting"); return; }
        if (dest != CAPTUREDEST_PC) {
            int rc = setProp(DPC_CaptureDestination, CAPTUREDEST_PC);
            if (rc != Ptp.RC_OK) { log.log("set capture destination: " + Ptp.hex(rc)); return; }
        }
        tellFreeSpace();
        long until = System.currentTimeMillis() + 3000;
        while (System.currentTimeMillis() < until) {
            pollEvents();
            Long shots = props.get(DPC_AvailableShots);
            if (shots == null || shots > 0) break;
            sleep(50);
        }
    }

    private void tellFreeSpace() throws IOException {
        Ptp.Result r = ptp.run(OC_PCHDDCapacity, 0x0fffffff, 0x1000, 1);
        if (!r.ok() && r.code != Ptp.RC_DEVICE_BUSY) log.log("free space note: " + Ptp.hex(r.code));
    }

    int setProp(int code, int value) throws IOException {
        byte[] d = new byte[12];
        Ptp.put32(d, 0, 12); Ptp.put32(d, 4, code); Ptp.put32(d, 8, value);
        Ptp.Result r = ptp.run(OC_SetDevicePropValueEx, new int[0], d, 5000);
        if (r.ok()) props.put(code, (long) value);
        return r.code;
    }

    /** Reads what changed on the camera: settings, and photos waiting to be downloaded. */
    int pollEvents() throws IOException {
        Ptp.Result r = ptp.run(OC_GetEvent, new int[0], null, 5000);
        if (!r.ok()) {
            if (r.code == Ptp.RC_DEVICE_BUSY) return 0;
            throw new CamError("The Canon did not report its status (" + Ptp.hex(r.code) + ")", r.code);
        }
        return r.data == null ? 0 : parseEvents(r.data);
    }

    int parseEvents(byte[] d) {
        int pos = 0, count = 0;
        while (pos + 8 <= d.length) {
            int size = Ptp.get32(d, pos), ec = Ptp.get32(d, pos + 4);
            if (size < 8 || pos + size > d.length) break;
            if (size == 8 && ec == 0) break;
            switch (ec) {
                case EC_PropValueChanged:
                    if (size >= 16) {
                        props.put(Ptp.get32(d, pos + 8), Ptp.getU32(d, pos + 12));
                    } else if (size >= 14) {
                        props.put(Ptp.get32(d, pos + 8), (long) Ptp.get16(d, pos + 12));
                    }
                    break;
                case EC_RequestObjectTransfer:
                case EC_RequestObjectTransfer64:
                    if (size >= 0x1c) {
                        Obj o = new Obj();
                        o.handle = Ptp.get32(d, pos + 0x08);
                        o.ofc = Ptp.get16(d, pos + 0x0c);
                        o.size = Ptp.getU32(d, pos + 0x14);
                        o.storage = 0;
                        o.name = cstr(d, pos + 0x1c, pos + size);
                        objects.add(o);
                    }
                    break;
                case EC_ObjectAddedEx:
                    if (size >= 0x28) {
                        Obj o = new Obj();
                        o.handle = Ptp.get32(d, pos + 0x08);
                        o.storage = Ptp.get32(d, pos + 0x0c);
                        o.ofc = Ptp.get16(d, pos + 0x10);
                        o.size = Ptp.getU32(d, pos + 0x1c);
                        o.name = cstr(d, pos + 0x28, pos + size);
                        if (o.ofc != 0x3001) objects.add(o);   // 0x3001 = folder
                    }
                    break;
                default:
                    break;
            }
            count++;
            pos += size;
        }
        return count;
    }

    /** Switches the Canon's live view to the tablet. Safe to call again. */
    void startLive() throws IOException {
        pollEvents();
        Long mode = props.get(DPC_EVFMode);
        if (mode == null || mode != 1) {
            int rc = setProp(DPC_EVFMode, 1);
            if (rc != Ptp.RC_OK && rc != Ptp.RC_DEVICE_BUSY) log.log("live view mode: " + Ptp.hex(rc));
        }
        Long out = props.get(DPC_EVFOutputDevice);
        if (out == null || (out & ~1L) == 0) {
            int rc = setProp(DPC_EVFOutputDevice, 2);
            if (rc != Ptp.RC_OK) log.log("live view to tablet: " + Ptp.hex(rc));
        }
        liveStarted = true;
    }

    /** Older way to start live view, used only when frames never come. */
    void initiateViewfinder() throws IOException {
        if (supports(OC_InitiateViewfinder)) {
            Ptp.Result r = ptp.run(OC_InitiateViewfinder);
            log.log("initiate viewfinder: " + Ptp.hex(r.code));
        }
        Long out = props.get(DPC_EVFOutputDevice);
        int rc = setProp(DPC_EVFOutputDevice, (int) ((out == null ? 0 : out) | 2));
        if (rc != Ptp.RC_OK) log.log("live view to tablet (again): " + Ptp.hex(rc));
    }

    /** One live view picture (JPEG), or null when the camera has no new picture yet. */
    byte[] liveFrame() throws IOException {
        Ptp.Result r = ptp.run(OC_GetViewFinderData, new int[]{0x00200000, 0, 0}, null, 4000);
        if (r.code == Ptp.RC_CANON_NOT_READY || r.code == Ptp.RC_DEVICE_BUSY) return null;
        if (!r.ok()) throw new CamError("live view error " + Ptp.hex(r.code), r.code);
        if (r.data == null) return null;
        byte[] d = r.data;
        int pos = 0;
        while (pos + 8 <= d.length) {
            int len = Ptp.get32(d, pos), type = Ptp.get32(d, pos + 4);
            if (len < 8 || pos + len > d.length) break;
            if (type == 1 || type == 11) {
                byte[] jpg = new byte[len - 8];
                System.arraycopy(d, pos + 8, jpg, 0, jpg.length);
                return jpg;
            }
            pos += len;
        }
        // Some cameras send the JPEG without the record header
        if (d.length > 3 && (d[0] & 0xff) == 0xFF && (d[1] & 0xff) == 0xD8) return d;
        return null;
    }

    void keepAwake() throws IOException {
        long now = System.currentTimeMillis();
        if (now - lastKeepAlive < 10000) return;
        lastKeepAlive = now;
        if (supports(OC_KeepDeviceOn)) ptp.run(OC_KeepDeviceOn);
    }

    /** Takes a photo and downloads it. Returns the JPEG bytes. */
    byte[] capture() throws IOException {
        pollEvents();
        objects.clear();
        Long dest = props.get(DPC_CaptureDestination);
        if (dest != null && dest != CAPTUREDEST_PC) captureToTablet();
        Long shots = props.get(DPC_AvailableShots);
        if (dest != null && (shots == null || shots < 100)) tellFreeSpace();

        if (supports(OC_RemoteReleaseOn)) {
            // Half press: the camera focuses (this call returns when focusing is done)
            Ptp.Result r = ptp.run(OC_RemoteReleaseOn, new int[]{1, 0}, null, 15000);
            if (!r.ok()) throw new CamError("The Canon could not start the photo (" + Ptp.hex(r.code) + ")", r.code);
            long t = System.currentTimeMillis();
            while (System.currentTimeMillis() - t < 300) { pollEvents(); sleep(30); }
            // Full press
            r = ptp.run(OC_RemoteReleaseOn, new int[]{2, 0}, null, 15000);
            if (!r.ok()) {
                try { pollEvents(); ptp.run(OC_RemoteReleaseOff, 1); } catch (IOException ignored) { }
                throw new CamError(focusHelp(r.code), r.code);
            }
            ptp.run(OC_RemoteReleaseOff, new int[]{2}, null, 15000);
            pollEvents();
            ptp.run(OC_RemoteReleaseOff, new int[]{1}, null, 15000);
        } else if (supports(OC_RemoteRelease)) {
            Ptp.Result r = ptp.run(OC_RemoteRelease, new int[0], null, 15000);
            if (!r.ok()) throw new CamError(focusHelp(r.code), r.code);
        } else {
            throw new CamError("This Canon cannot take photos by remote control.", 0);
        }

        // Wait for the camera to say the photo is ready
        long start = System.currentTimeMillis();
        int wait = 20;
        while (objects.isEmpty()) {
            if (System.currentTimeMillis() - start > 20000) throw new CamError("The Canon took the photo but did not send it. Make sure an SD card is in and Image quality is a JPEG setting.", 0);
            sleep(wait);
            wait = Math.min(200, wait * 2);
            if (pollEvents() > 0) wait = 20;
        }
        sleep(100);
        pollEvents();   // RAW+JPEG sends two files close together

        byte[] jpeg = null, other = null;
        for (Obj o : new ArrayList<>(objects)) {
            byte[] data = download(o);
            if (o.storage == 0) ptp.run(OC_TransferComplete, o.handle);
            boolean isJpeg = o.ofc == OFC_JPEG || (data.length > 3 && (data[0] & 0xff) == 0xFF && (data[1] & 0xff) == 0xD8);
            if (isJpeg && jpeg == null) jpeg = data;
            else if (other == null) other = data;
        }
        objects.clear();
        if (jpeg == null) throw new CamError("The Canon sent a RAW file. Set Image quality on the camera to a JPEG setting (not RAW).", 0);
        return jpeg;
    }

    private byte[] download(Obj o) throws IOException {
        long size = o.size;
        if (size <= 0) {
            Ptp.Result info = ptp.run(OC_GetObjectInfo, o.handle);
            if (info.ok() && info.data != null && info.data.length >= 12) size = Ptp.getU32(info.data, 8);
        }
        if (size <= 0) throw new CamError("The Canon sent an empty photo.", 0);
        ByteArrayOutputStream out = new ByteArrayOutputStream((int) size);
        long off = 0;
        final int BLOCK = 1024 * 1024;
        while (off < size) {
            int want = (int) Math.min(BLOCK, size - off);
            Ptp.Result r = ptp.run(OC_GetPartialObject, new int[]{o.handle, (int) off, want}, null, 10000);
            if (!r.ok() || r.data == null) throw new CamError("Downloading the photo failed (" + Ptp.hex(r.code) + ")", r.code);
            out.write(r.data, 0, r.data.length);
            off += r.data.length;
            if (r.data.length == 0) throw new CamError("Downloading the photo stopped.", 0);
        }
        return out.toByteArray();
    }

    private static String focusHelp(int code) {
        if (code == Ptp.RC_CANON_NOT_READY || code == Ptp.RC_DEVICE_BUSY || code == Ptp.RC_GENERAL_ERROR)
            return "The Canon could not focus, so it did not take the photo. Add more light, or focus once and switch the lens to MF. (" + Ptp.hex(code) + ")";
        return "The Canon did not take the photo (" + Ptp.hex(code) + ")";
    }

    private static void check(Ptp.Result r, String what) throws CamError {
        if (!r.ok()) throw new CamError("The Canon refused " + what + " (" + Ptp.hex(r.code) + ")", r.code);
    }

    private void parseDeviceInfo(byte[] d) {
        try {
            int p = 2 + 4 + 2;                 // standard version, vendor extension id, vendor version
            p = skipString(d, p);              // vendor extension description
            p += 2;                            // functional mode
            int n = Ptp.get32(d, p); p += 4;   // operations supported
            for (int i = 0; i < n; i++) { ops.add(Ptp.get16(d, p)); p += 2; }
            for (int k = 0; k < 4; k++) { n = Ptp.get32(d, p); p += 4 + 2 * n; }   // events, properties, capture formats, image formats
            p = skipString(d, p);              // manufacturer
            int[] at = new int[]{p};
            String m = readString(d, at);
            if (m != null && !m.isEmpty()) model = m;
        } catch (RuntimeException e) {
            log.log("could not read camera info: " + e);
        }
    }

    private static int skipString(byte[] d, int p) { int n = d[p] & 0xff; return p + 1 + 2 * n; }

    private static String readString(byte[] d, int[] at) {
        int p = at[0], n = d[p] & 0xff;
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) { int c = Ptp.get16(d, p + 1 + 2 * i); if (c != 0) sb.append((char) c); }
        at[0] = p + 1 + 2 * n;
        return sb.toString();
    }

    private static String cstr(byte[] d, int from, int to) {
        int e = from;
        while (e < to && e < d.length && d[e] != 0) e++;
        return new String(d, from, Math.max(0, e - from), StandardCharsets.US_ASCII);
    }

    static void sleep(long ms) { try { Thread.sleep(ms); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); } }
}
