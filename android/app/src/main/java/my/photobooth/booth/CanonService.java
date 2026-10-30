package my.photobooth.booth;

import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.ArrayDeque;
import java.util.Date;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

/**
 * Runs everything that talks to the Canon on one background thread, so commands never overlap.
 * Live view frames are fetched continuously while the booth screen is asking for them.
 */
final class CanonService {
    /** Finds the Canon on USB, asks for permission and opens it. */
    interface Opener {
        UsbLink open() throws IOException;
        void close();
        boolean present();
    }

    interface Callback { void done(String json); }

    /** A problem that trying again will not fix (no camera, permission refused). */
    static final class NoRetry extends IOException {
        NoRetry(String m) { super(m); }
    }

    private final Opener opener;
    private final LinkedBlockingQueue<Runnable> tasks = new LinkedBlockingQueue<>();
    private final ArrayDeque<String> logLines = new ArrayDeque<>();
    private final Map<Integer, byte[]> photos = new HashMap<>();
    private final Object frameLock = new Object();
    private final Thread thread;

    // Only touched on the camera thread
    private CanonEos cam;
    private int photoId = 0;
    private long notReadySince = 0, lastEvents = 0, lastIdleCheck = 0;
    private boolean triedInitiate = false;
    private int liveFails = 0;

    // Read from other threads
    private volatile boolean liveWanted = false;
    private volatile long frameWantedAt = 0;
    private volatile String model = "", liveError = "";
    private volatile boolean connected = false;
    private volatile int frames = 0, errors = 0;
    private volatile long lastFrameAt = 0, connectedAt = 0;
    private byte[] frame;
    private long frameSeq = 0;

    CanonService(Opener opener) {
        this.opener = opener;
        thread = new Thread(this::loop, "canon");
        thread.setDaemon(true);
        thread.start();
    }

    /* ---------------- Called from the web page (any thread) ---------------- */

    void call(String op, Callback cb) {
        tasks.add(() -> {
            String res;
            try {
                switch (op) {
                    case "connect": res = doConnect(); break;
                    case "disconnect": doDisconnect(); res = ok(""); break;
                    case "liveOn": res = doLiveOn(); break;
                    case "liveOff": liveWanted = false; res = ok(""); break;
                    case "capture": res = doCapture(); break;
                    case "ping": res = doPing(); break;
                    default: res = fail("unknown command " + op);
                }
            } catch (Throwable t) {
                errors++;
                log("error in " + op + ": " + t);
                res = fail(message(t));
            }
            cb.done(res);
        });
    }

    /** Waits for a live view picture newer than `after`. Returns null when none came in time. */
    byte[] waitFrame(long after, long timeoutMs, long[] seqOut) {
        frameWantedAt = System.currentTimeMillis();
        long until = System.currentTimeMillis() + timeoutMs;
        synchronized (frameLock) {
            while (frameSeq <= after || frame == null) {
                long left = until - System.currentTimeMillis();
                if (left <= 0) return null;
                tasks.add(() -> { });   // wake the camera thread if it is idling
                try { frameLock.wait(Math.min(left, 250)); } catch (InterruptedException e) { return null; }
                frameWantedAt = System.currentTimeMillis();
            }
            seqOut[0] = frameSeq;
            return frame;
        }
    }

    byte[] takePhoto(int id) {
        synchronized (photos) { return photos.remove(id); }
    }

    String liveError() { return liveError; }

    boolean present() { try { return opener.present(); } catch (RuntimeException e) { return false; } }

    /** The Canon was unplugged or switched off. */
    void detached() {
        tasks.add(() -> {
            if (cam != null) log("Canon unplugged / switched off");
            closeQuietly(false);
            liveError = "The Canon was switched off or unplugged.";
        });
    }

    String status() {
        long now = System.currentTimeMillis();
        return "{\"connected\":" + connected + ",\"model\":" + q(model) + ",\"live\":" + liveWanted
                + ",\"frames\":" + frames + ",\"errors\":" + errors
                + ",\"lastFrameMs\":" + (lastFrameAt == 0 ? -1 : now - lastFrameAt)
                + ",\"liveError\":" + q(liveError) + ",\"present\":" + present() + "}";
    }

    String logText() {
        synchronized (logLines) { return String.join("\n", logLines); }
    }

    void log(String s) {
        String line = new SimpleDateFormat("HH:mm:ss", Locale.UK).format(new Date()) + " " + s;
        synchronized (logLines) {
            logLines.add(line);
            while (logLines.size() > 150) logLines.removeFirst();
        }
        System.out.println("canon: " + line);
    }

    /* ---------------- Camera thread ---------------- */

    private void loop() {
        while (true) {
            try {
                boolean pumping = cam != null && liveWanted && System.currentTimeMillis() - frameWantedAt < 1500;
                Runnable t = pumping ? tasks.poll() : tasks.poll(200, TimeUnit.MILLISECONDS);
                if (t != null) { t.run(); continue; }
                if (cam == null) continue;
                if (pumping) pumpFrame();
                else idle();
            } catch (InterruptedException e) {
                return;
            } catch (Throwable e) {
                errors++;
                handleFailure(e);
            }
        }
    }

    private void pumpFrame() throws IOException {
        if (!cam.liveStarted) { cam.startLive(); notReadySince = 0; triedInitiate = false; }
        byte[] jpg = cam.liveFrame();
        long now = System.currentTimeMillis();
        if (jpg != null) {
            synchronized (frameLock) { frame = jpg; frameSeq++; frameLock.notifyAll(); }
            frames++; lastFrameAt = now; notReadySince = 0; liveFails = 0; liveError = "";
        } else {
            if (notReadySince == 0) notReadySince = now;
            long waiting = now - notReadySince;
            if (waiting > 4000 && !triedInitiate) { triedInitiate = true; log("live view not starting: trying again"); cam.initiateViewfinder(); }
            if (waiting > 12000) { liveError = "The Canon live view does not start. Check the camera is not in video mode and the lens is on."; notReadySince = now; triedInitiate = false; cam.liveStarted = false; }
            CanonEos.sleep(15);
        }
        if (now - lastEvents > 500) { lastEvents = now; cam.pollEvents(); }
        cam.keepAwake();
    }

    /** No one is looking at the live view: just keep the camera awake and notice if it drops. */
    private void idle() throws IOException {
        long now = System.currentTimeMillis();
        if (now - lastIdleCheck < 3000) return;
        lastIdleCheck = now;
        cam.pollEvents();
        cam.keepAwake();
    }

    private void handleFailure(Throwable e) {
        log("problem: " + message(e));
        if (e instanceof CanonEos.CamError) {
            // The camera answered but said no. Wait a moment, then restart the live view.
            liveError = message(e);
            CanonEos.sleep(300);
            if (++liveFails >= 5 && cam != null) { cam.liveStarted = false; liveFails = 0; }
            return;
        }
        // The USB link itself failed: unblock it and reopen the session
        liveError = "Reconnecting the Canon…";
        if (recover()) { liveError = ""; return; }
        liveError = "The Canon stopped answering. Switch it off and on.";
    }

    /** Gets a stuck USB link working again: reset, reopen the session, then if needed reopen the device. */
    private boolean recover() {
        if (cam == null) return false;
        for (int attempt = 1; attempt <= 3; attempt++) {
            try {
                if (attempt < 3 && link != null) {
                    log("recovering USB link (try " + attempt + ")");
                    link.recover();
                    CanonEos.sleep(300);
                    openCamera(link);
                } else {
                    log("reopening the Canon");
                    closeQuietly(false);
                    CanonEos.sleep(1500);
                    openCamera(opener.open());
                }
                log("Canon back");
                return true;
            } catch (Throwable t) {
                log("recover failed: " + message(t));
                if (t instanceof NoRetry) break;
                CanonEos.sleep(800L * attempt);
            }
        }
        closeQuietly(false);
        return false;
    }

    private UsbLink link;

    private void openCamera(UsbLink l) throws IOException {
        link = l;
        CanonEos c = new CanonEos(new Ptp(l), this::log);
        cam = c;   // so a failure here can still be recovered/closed
        connected = false;
        c.open();
        model = c.model;
        connected = true;
        connectedAt = System.currentTimeMillis();
        if (liveWanted) { c.startLive(); notReadySince = 0; triedInitiate = false; }
    }

    private String doConnect() throws IOException {
        if (cam != null && connected) {
            try { cam.pollEvents(); return ok(",\"model\":" + q(model)); }
            catch (IOException e) { log("old connection is not answering: " + message(e)); closeQuietly(false); }
        }
        IOException last = null;
        for (int attempt = 1; attempt <= 3; attempt++) {
            try {
                log("connecting (try " + attempt + ")");
                UsbLink l = opener.open();
                try { openCamera(l); }
                catch (Ptp.LinkError e) {
                    log("first contact failed: " + e.getMessage() + " — resetting the USB link");
                    l.recover();
                    CanonEos.sleep(500);
                    openCamera(l);
                }
                log("connected: " + model);
                liveError = "";
                return ok(",\"model\":" + q(model));
            } catch (NoRetry e) {
                closeQuietly(false);
                throw e;
            } catch (IOException e) {
                last = e;
                log("try " + attempt + " failed: " + message(e));
                closeQuietly(false);
                CanonEos.sleep(1000L * attempt);
            }
        }
        throw last;
    }

    private void doDisconnect() {
        liveWanted = false;
        closeQuietly(true);
        log("disconnected");
    }

    private String doLiveOn() throws IOException {
        if (cam == null) return fail("The Canon is not connected.");
        liveWanted = true;
        frameWantedAt = System.currentTimeMillis();
        cam.liveStarted = false;
        try {
            cam.startLive();
        } catch (Ptp.LinkError e) {
            if (!recover()) throw e;
        }
        notReadySince = 0; triedInitiate = false;
        return ok("");
    }

    private String doPing() throws IOException {
        if (cam == null) return fail("The Canon is not connected.");
        try { cam.pollEvents(); cam.keepAwake(); }
        catch (Ptp.LinkError e) { if (!recover()) throw e; }
        return ok("");
    }

    private String doCapture() throws IOException {
        if (cam == null) return fail("The Canon is not connected.");
        long t0 = System.currentTimeMillis();
        byte[] jpg;
        try {
            jpg = cam.capture();
        } catch (Ptp.LinkError e) {
            log("photo: USB problem: " + e.getMessage());
            recover();
            throw e;
        } finally {
            if (cam != null) cam.liveStarted = false;   // the live view restarts after every photo
        }
        int id = ++photoId;
        synchronized (photos) {
            photos.put(id, jpg);
            photos.keySet().removeIf(k -> k < id - 3);   // never keep more than a few in memory
        }
        long ms = System.currentTimeMillis() - t0;
        log("photo " + (jpg.length / 1024) + " KB in " + ms + " ms");
        return ok(",\"id\":" + id + ",\"size\":" + jpg.length + ",\"ms\":" + ms);
    }

    private void closeQuietly(boolean polite) {
        if (cam != null && polite) { try { cam.close(); } catch (Throwable ignored) { } }
        cam = null;
        link = null;
        connected = false;
        try { opener.close(); } catch (Throwable ignored) { }
    }

    /* ---------------- Helpers ---------------- */

    static String message(Throwable t) {
        String m = t.getMessage();
        return m == null || m.isEmpty() ? t.getClass().getSimpleName() : m;
    }

    static String ok(String extra) { return "{\"ok\":true" + extra + "}"; }

    static String fail(String m) { return "{\"ok\":false,\"error\":" + q(m) + "}"; }

    static String q(String s) {
        if (s == null) return "null";
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20 || c == 0x2028 || c == 0x2029) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        return b.append('"').toString();
    }
}
