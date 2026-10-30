package my.photobooth.booth;

import android.Manifest;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * The booth app: the Photobooth website in a full-screen browser, plus a direct USB link to the Canon.
 * The website asks the app for live view frames and photos (see public/app/app.js, "native app").
 */
public class MainActivity extends Activity {
    static final String HOST = "photobooth-studio.harizwer03.workers.dev";
    static final String HOME = "https://" + HOST + "/app/";
    static final String VERSION = "1.0";

    private static CanonService canon;   // survives the screen being recreated
    private WebView web;
    private FrameLayout root;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private PermissionRequest pendingWebPermission;
    private ValueCallback<Uri[]> pendingFiles;
    private boolean errorShown = false;

    private final BroadcastReceiver usbEvents = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            UsbDevice d = i.getParcelableExtra(UsbManager.EXTRA_DEVICE);
            if (d != null && !UsbOpener.isCamera(d)) return;
            if (UsbManager.ACTION_USB_DEVICE_DETACHED.equals(i.getAction())) {
                canon.detached();
                fire("disconnect");
            } else {
                fire("connect");
            }
        }
    };

    @Override protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (canon == null) canon = new CanonService(new UsbOpener(this));

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        setContentView(root);
        createWebView();
        if (saved != null) web.restoreState(saved);
        if (web.getUrl() == null) {
            if (webViewMajor() > 0 && webViewMajor() < MIN_WEBVIEW) showUpdateWebView();
            else web.loadUrl(HOME);
        }

        IntentFilter f = new IntentFilter();
        f.addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED);
        f.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED);
        registerReceiver(usbEvents, f);

        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.CAMERA}, 1);
    }

    private void createWebView() {
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setUserAgentString(s.getUserAgentString() + " PhotoboothApp/" + VERSION);
        CookieManager.getInstance().setAcceptCookie(true);
        WebView.setWebContentsDebuggingEnabled(true);
        web.addJavascriptInterface(new Bridge(), "PBNative");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener((url, ua, cd, mime, len) -> openOutside(url));
    }

    /** The booth website needs a recent "Android System WebView" (the browser engine apps use). */
    static final int MIN_WEBVIEW = 98;

    static int webViewMajor() {
        try {
            android.content.pm.PackageInfo p = WebView.getCurrentWebViewPackage();
            if (p == null || p.versionName == null) return 0;
            return Integer.parseInt(p.versionName.split("\\.")[0]);
        } catch (RuntimeException e) {
            return 0;
        }
    }

    private void showUpdateWebView() {
        android.content.pm.PackageInfo p = WebView.getCurrentWebViewPackage();
        String pkg = p != null ? p.packageName : "com.google.android.webview";
        String html = "<html><head><meta name=viewport content='width=device-width,initial-scale=1'></head>"
                + "<body style='background:#111;color:#eee;font:18px sans-serif;padding:32px;line-height:1.5'>"
                + "<h2>One update needed</h2>"
                + "<p>This tablet's <b>Android System WebView</b> is too old (version " + webViewMajor() + "). "
                + "The booth needs version " + MIN_WEBVIEW + " or newer. Updating it is free.</p>"
                + "<p><a style='display:inline-block;background:#ff5c8a;color:#fff;padding:14px 22px;border-radius:10px;text-decoration:none' "
                + "href='market://details?id=" + pkg + "'>Update in Play Store</a></p>"
                + "<p>After updating, close this app and open it again. Also update <b>Google Chrome</b> if Play Store offers it.</p>"
                + "<p style='margin-top:40px'><a style='color:#aaa' href='" + HOME + "'>Continue anyway</a></p></body></html>";
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
    }

    /** Tells the page that the Canon was plugged in or out. */
    private void fire(String what) {
        ui.post(() -> { if (web != null) web.evaluateJavascript("window.dispatchEvent(new CustomEvent('pbcanon',{detail:'" + what + "'}))", null); });
    }

    @Override protected void onResume() {
        super.onResume();
        hideSystemBars();
        if (web != null) web.onResume();
    }

    @Override protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override public void onWindowFocusChanged(boolean focus) {
        super.onWindowFocusChanged(focus);
        if (focus) hideSystemBars();
    }

    @SuppressWarnings("deprecation")
    private void hideSystemBars() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    @Override protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // Canon plugged in while the app is open: Android hands it to us (permission comes with it)
        if (intent != null && UsbManager.ACTION_USB_DEVICE_ATTACHED.equals(intent.getAction())) fire("connect");
    }

    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        // otherwise stay in the booth: the Home button still leaves the app
    }

    @Override protected void onDestroy() {
        try { unregisterReceiver(usbEvents); } catch (RuntimeException ignored) { }
        if (web != null) { root.removeView(web); web.destroy(); web = null; }
        super.onDestroy();
    }

    @Override public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (pendingWebPermission != null) {
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) pendingWebPermission.grant(pendingWebPermission.getResources());
            else pendingWebPermission.deny();
            pendingWebPermission = null;
        }
    }

    @Override protected void onActivityResult(int req, int result, Intent data) {
        if (req == 2 && pendingFiles != null) {
            pendingFiles.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            pendingFiles = null;
        }
    }

    private void openOutside(String url) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
        catch (RuntimeException e) { Toast.makeText(this, "Cannot open " + url, Toast.LENGTH_LONG).show(); }
    }

    static boolean ours(Uri u) { return u != null && "https".equals(u.getScheme()) && HOST.equals(u.getHost()); }

    /* ---------------- What the website can ask the app ---------------- */

    final class Bridge {
        @JavascriptInterface public void call(String op, int id) {
            canon.call(op, json -> ui.post(() -> {
                if (web != null) web.evaluateJavascript("window.__pbNativeDone&&window.__pbNativeDone(" + id + "," + json + ")", null);
            }));
        }
        @JavascriptInterface public String status() { return canon.status(); }
        @JavascriptInterface public String log() { return canon.logText(); }
        @JavascriptInterface public boolean present() { return canon.present(); }
        @JavascriptInterface public String version() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return VERSION; }
        }
        @JavascriptInterface public void copy(String text) {
            ui.post(() -> {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("Photobooth", text));
            });
        }
        @JavascriptInterface public void reload() { ui.post(() -> { if (web != null) web.reload(); }); }
    }

    /* ---------------- Browser behaviour ---------------- */

    final class Client extends WebViewClient {
        @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (ours(u)) return false;
            openOutside(u.toString());
            return true;
        }

        @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (!ours(u) || u.getPath() == null || !u.getPath().startsWith("/__canon/")) return null;
            try {
                switch (u.getPath()) {
                    case "/__canon/frame": {
                        long after = parseLong(u.getQueryParameter("after"));
                        long[] seq = {0};
                        byte[] f = canon.waitFrame(after, 3000, seq);
                        if (f == null) {
                            String why = canon.liveError();
                            return text(503, why.isEmpty() ? "No live view picture from the Canon yet" : why);
                        }
                        Map<String, String> h = headers();
                        h.put("X-Seq", String.valueOf(seq[0]));
                        return new WebResourceResponse("image/jpeg", null, 200, "OK", h, new ByteArrayInputStream(f));
                    }
                    case "/__canon/photo": {
                        byte[] p = canon.takePhoto((int) parseLong(u.getQueryParameter("id")));
                        if (p == null) return text(404, "photo not found");
                        return new WebResourceResponse("image/jpeg", null, 200, "OK", headers(), new ByteArrayInputStream(p));
                    }
                    default:
                        return text(404, "unknown");
                }
            } catch (RuntimeException e) {
                return text(500, String.valueOf(e));
            }
        }

        @Override public void onPageStarted(WebView v, String url, Bitmap icon) { errorShown = false; }

        @Override public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
            if (!req.isForMainFrame() || errorShown) return;
            errorShown = true;
            String html = "<html><body style='background:#111;color:#eee;font:20px sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center'>"
                    + "<div>No internet connection.<br><small>Trying again in a few seconds…</small></div></body></html>";
            v.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
            ui.postDelayed(() -> { if (web != null) web.loadUrl(HOME); }, 6000);
        }

        @Override public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail d) {
            // The browser part crashed: build a fresh one instead of closing the app
            if (web != null) { root.removeView(web); web.destroy(); web = null; }
            createWebView();
            web.loadUrl(HOME);
            return true;
        }
    }

    final class Chrome extends WebChromeClient {
        @Override public void onPermissionRequest(PermissionRequest r) {
            if (!ours(r.getOrigin())) { r.deny(); return; }
            if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) r.grant(r.getResources());
            else { pendingWebPermission = r; requestPermissions(new String[]{Manifest.permission.CAMERA}, 1); }
        }

        @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
            if (pendingFiles != null) pendingFiles.onReceiveValue(null);
            pendingFiles = cb;
            try { startActivityForResult(p.createIntent(), 2); }
            catch (RuntimeException e) { pendingFiles = null; return false; }
            return true;
        }

        // Without this, video elements show a grey "play" picture before they start
        @Override public Bitmap getDefaultVideoPoster() { return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888); }

        @Override public boolean onConsoleMessage(ConsoleMessage m) {
            Log.d("booth-web", m.message() + " @" + m.sourceId() + ":" + m.lineNumber());
            return true;
        }
    }

    private static Map<String, String> headers() {
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "no-store");
        h.put("Cross-Origin-Resource-Policy", "same-origin");
        return h;
    }

    private static WebResourceResponse text(int code, String msg) {
        return new WebResourceResponse("text/plain", "utf-8", code, code == 200 ? "OK" : "Error", headers(),
                new ByteArrayInputStream(msg.getBytes(StandardCharsets.UTF_8)));
    }

    private static long parseLong(String s) {
        try { return s == null ? 0 : Long.parseLong(s); } catch (NumberFormatException e) { return 0; }
    }
}
