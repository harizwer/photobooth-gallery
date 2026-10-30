package my.photobooth.booth;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.Build;

import java.io.IOException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Finds the Canon on USB, gets Android's permission, and opens its photo (PTP) interface. */
final class UsbOpener implements CanonService.Opener {
    static final int CANON_VENDOR = 0x04A9;
    private static final String ACTION_PERMISSION = "my.photobooth.booth.USB_PERMISSION";

    private final Context ctx;
    private final UsbManager usb;
    private UsbDeviceConnection conn;
    private UsbInterface claimed;
    private volatile CountDownLatch permissionWait;
    private volatile boolean permissionGranted;

    UsbOpener(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        this.usb = (UsbManager) ctx.getSystemService(Context.USB_SERVICE);
        BroadcastReceiver r = new BroadcastReceiver() {
            @Override public void onReceive(Context c, Intent i) {
                permissionGranted = i.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false);
                CountDownLatch l = permissionWait;
                if (l != null) l.countDown();
            }
        };
        IntentFilter f = new IntentFilter(ACTION_PERMISSION);
        if (Build.VERSION.SDK_INT >= 33) this.ctx.registerReceiver(r, f, Context.RECEIVER_NOT_EXPORTED);
        else this.ctx.registerReceiver(r, f);
    }

    static boolean isCamera(UsbDevice d) {
        if (d == null) return false;
        if (findPtp(d) == null) return false;
        return d.getVendorId() == CANON_VENDOR || findPtpClass(d) != null;
    }

    UsbDevice find() {
        UsbDevice other = null;
        for (UsbDevice d : usb.getDeviceList().values()) {
            if (d.getVendorId() == CANON_VENDOR && findPtp(d) != null) return d;
            if (other == null && findPtpClass(d) != null) other = d;
        }
        return other;
    }

    @Override public boolean present() { return find() != null; }

    @Override public synchronized UsbLink open() throws IOException {
        close();
        UsbDevice d = find();
        if (d == null) throw new CanonService.NoRetry("No Canon found on USB. Check the cable and the hub, switch the Canon on (photo mode, not video), then try again.");
        if (!usb.hasPermission(d)) askPermission(d);
        conn = usb.openDevice(d);
        if (conn == null) throw new IOException("Android could not open the Canon. Unplug the cable and plug it back in.");
        UsbInterface itf = findPtp(d);
        if (!conn.claimInterface(itf, true)) {
            close();
            throw new IOException("Another app is using the Canon. Close the Gallery/Photos app and OurBooth, then try again.");
        }
        claimed = itf;
        UsbEndpoint in = null, out = null;
        for (int i = 0; i < itf.getEndpointCount(); i++) {
            UsbEndpoint e = itf.getEndpoint(i);
            if (e.getType() != UsbConstants.USB_ENDPOINT_XFER_BULK) continue;
            if (e.getDirection() == UsbConstants.USB_DIR_IN) in = e; else out = e;
        }
        if (in == null || out == null) { close(); throw new CanonService.NoRetry("This USB device is not a camera."); }
        AndroidLink link = new AndroidLink(conn, itf, in, out);
        link.drain();
        return link;
    }

    private void askPermission(UsbDevice d) throws IOException {
        permissionWait = new CountDownLatch(1);
        permissionGranted = false;
        Intent i = new Intent(ACTION_PERMISSION).setPackage(ctx.getPackageName());
        int flags = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
        PendingIntent pi = PendingIntent.getBroadcast(ctx, 0, i, flags | PendingIntent.FLAG_UPDATE_CURRENT);
        usb.requestPermission(d, pi);
        try {
            if (!permissionWait.await(90, TimeUnit.SECONDS)) throw new CanonService.NoRetry("Tap OK on the “Allow Photobooth to access the Canon” message, then try again.");
        } catch (InterruptedException e) {
            throw new IOException("interrupted");
        }
        if (!permissionGranted || !usb.hasPermission(d))
            throw new CanonService.NoRetry("Permission for the Canon was not given. Tap Connect again and choose OK (tick “Always” / “Use by default”).");
    }

    @Override public synchronized void close() {
        if (conn != null) {
            try { if (claimed != null) conn.releaseInterface(claimed); } catch (RuntimeException ignored) { }
            try { conn.close(); } catch (RuntimeException ignored) { }
        }
        conn = null;
        claimed = null;
    }

    /** The still-image (PTP) interface: class 6. */
    private static UsbInterface findPtpClass(UsbDevice d) {
        for (int i = 0; i < d.getInterfaceCount(); i++) {
            UsbInterface itf = d.getInterface(i);
            if (itf.getInterfaceClass() == UsbConstants.USB_CLASS_STILL_IMAGE) return itf;
        }
        return null;
    }

    private static UsbInterface findPtp(UsbDevice d) {
        UsbInterface itf = findPtpClass(d);
        if (itf != null) return itf;
        // Some cameras report a vendor class: take the first interface with bulk in + out
        for (int i = 0; i < d.getInterfaceCount(); i++) {
            UsbInterface x = d.getInterface(i);
            boolean hasIn = false, hasOut = false;
            for (int k = 0; k < x.getEndpointCount(); k++) {
                UsbEndpoint e = x.getEndpoint(k);
                if (e.getType() != UsbConstants.USB_ENDPOINT_XFER_BULK) continue;
                if (e.getDirection() == UsbConstants.USB_DIR_IN) hasIn = true; else hasOut = true;
            }
            if (hasIn && hasOut) return x;
        }
        return null;
    }

    /** UsbLink over Android's USB host API. */
    static final class AndroidLink implements UsbLink {
        private final UsbDeviceConnection conn;
        private final UsbInterface itf;
        private final UsbEndpoint in, out;

        AndroidLink(UsbDeviceConnection conn, UsbInterface itf, UsbEndpoint in, UsbEndpoint out) {
            this.conn = conn; this.itf = itf; this.in = in; this.out = out;
        }

        @Override public int maxPacket() { return Math.max(64, in.getMaxPacketSize()); }

        // 16 KB pieces: some tablets' USB chips (e.g. Samsung Tab A8) break on bigger single transfers
        @Override public int maxTransfer() { return 16384; }

        @Override public int write(byte[] data, int len, int timeoutMs) {
            return conn.bulkTransfer(out, data, len, timeoutMs);
        }

        @Override public int read(byte[] buf, int len, int timeoutMs) {
            return conn.bulkTransfer(in, buf, len, timeoutMs);
        }

        @Override public void recover(boolean hard) {
            int id = itf.getId();
            if (hard) {
                // PTP "device reset" (class request 0x66), then wait until the camera says it is ready
                conn.controlTransfer(0x21, 0x66, 0, id, null, 0, 1000);
                byte[] st = new byte[32];
                for (int i = 0; i < 10; i++) {
                    CanonEos.sleep(100);
                    int n = conn.controlTransfer(0xA1, 0x67, 0, id, st, st.length, 500);
                    if (n >= 4 && Ptp.get16(st, 2) == Ptp.RC_OK) break;
                }
            }
            // Clear stalled endpoints (USB CLEAR_FEATURE ENDPOINT_HALT)
            conn.controlTransfer(0x02, 0x01, 0, in.getAddress(), null, 0, 1000);
            conn.controlTransfer(0x02, 0x01, 0, out.getAddress(), null, 0, 1000);
            drain();
        }

        /** Throws away anything left over from an earlier, unfinished command. */
        void drain() {
            byte[] junk = new byte[maxTransfer()];
            for (int i = 0; i < 40; i++) if (conn.bulkTransfer(in, junk, junk.length, 60) <= 0) break;
        }
    }
}
