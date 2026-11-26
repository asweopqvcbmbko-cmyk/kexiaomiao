package cn.edu.haust.campusassistant;

import android.annotation.SuppressLint;
import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.AccelerateInterpolator;
import android.view.animation.DecelerateInterpolator;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.ProfileStore;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.CookieHandler;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.spec.X509EncodedKeySpec;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashSet;
import javax.crypto.Cipher;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 安卓上的「看不见的浏览器」。
 *
 * 桌面版靠一个隐藏的 BrowserWindow 抓教务/通知/校园卡（见 lib/engine.js），
 * 安卓没有 BrowserWindow，就用这里的一个 WebView 顶上：
 *   - open()  可见 WebView 覆盖在应用之上，用来完成统一身份认证 / 学习通扫码
 *   - load()  在隐藏 WebView 里打开一个地址
 *   - eval()  在同一个隐藏 WebView 里执行 JS 并把结果带回来
 *   - cookies() 读默认 CookieManager（登录态就靠它，和应用内 WebView 共享）
 *
 * 用 Java 写是为了不给 app 模块再加 Kotlin 插件（少一层构建依赖）。
 */
@CapacitorPlugin(name = "SchoolBrowser", permissions = {
        @Permission(alias = "legacyGallery", strings = {Manifest.permission.WRITE_EXTERNAL_STORAGE})
})
public class SchoolBrowserPlugin extends Plugin {
    private static final Set<String> ALLOWED_LAUNCH_PACKAGES = new HashSet<>(Arrays.asList(
            "com.lantu.MobileCampus.haust", "com.chaoxing.mobile"
    ));

    private static final String UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

    private final Handler main = new Handler(Looper.getMainLooper());
    private WebView hidden;
    private String hiddenUrl = "";
    private String overlayUrl = "";
    private LinearLayout overlay;
    private LinearLayout overlayBar;
    private TextView overlayTitleView;
    private WebView overlayView;
    private Runnable overlayFlusher;
    private boolean overlayClosing = false;
    private boolean authOverlay;
    private boolean overlayVisible;

    /** 给 MainActivity 的返回键用：系统返回要先处理可见登录窗，而不是直接退出 App */
    private static SchoolBrowserPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) instance = null;
        main.post(() -> {
            closeOverlay();
            if (hidden != null) {
                hidden.stopLoading();
                hidden.setWebViewClient(null);
                ViewGroup parent = (ViewGroup) hidden.getParent();
                if (parent != null) parent.removeView(hidden);
                hidden.removeAllViews();
                hidden.destroy();
                hidden = null;
            }
        });
        super.handleOnDestroy();
    }

    /**
     * 处理原生 Overlay 的返回键：
     * 若 Overlay WebView 可以后退则先网页后退，否则关闭 Overlay。没有打开 Overlay 返回 false。
     */
    public static boolean handleBackPress() {
        final SchoolBrowserPlugin p = instance;
        if (p == null || !p.overlayVisible) return false;
        p.getActivity().runOnUiThread(() -> {
            if (p.overlayView != null && p.overlayView.canGoBack()) {
                p.overlayView.goBack();
            } else {
                p.closeOverlayAnimated(null, null);
            }
        });
        return true;
    }

    /** 兼容旧调用：登录窗开着就关掉并返回 true */
    public static boolean closeOverlayIfOpen() {
        final SchoolBrowserPlugin p = instance;
        if (p == null || !p.overlayVisible) return false;
        p.getActivity().runOnUiThread(p::closeOverlay);
        return true;
    }

    private boolean isHttpOrHttps(WebResourceRequest req) {
        Uri uri = req != null ? req.getUrl() : null;
        String scheme = uri != null ? uri.getScheme() : null;
        return "http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme);
    }

    /** 超星登录后常 302 跳转明文 http://i.chaoxing.com/base，自动升级为 https 避免 Android 9+ ERR_CLEARTEXT_NOT_PERMITTED */
    private String upgradeChaoxingHttp(Uri uri) {
        if (uri == null || !"http".equalsIgnoreCase(uri.getScheme())) return null;
        String host = uri.getHost();
        if (host == null) return null;
        String lower = host.toLowerCase();
        if (lower.equals("chaoxing.com") || lower.endsWith(".chaoxing.com")) {
            return "https" + uri.toString().substring(4);
        }
        return null;
    }

    /* ---------------- 可见登录窗 ---------------- */

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        String title = call.getString("title", "登录");
        boolean silent = call.getBoolean("silent", false);
        boolean desktopUa = call.getBoolean("desktopUa", false);
        if (url == null || url.isEmpty()) {
            call.reject("url required");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                if (authOverlay) {
                    JSObject ret = new JSObject();
                    ret.put("shown", false);
                    call.resolve(ret);
                    return;
                }
                closeOverlay();
                LinearLayout root = new LinearLayout(getContext());
                root.setOrientation(LinearLayout.VERTICAL);
                root.setBackgroundColor(Color.WHITE);

                LinearLayout bar = new LinearLayout(getContext());
                bar.setOrientation(LinearLayout.HORIZONTAL);
                bar.setBackgroundColor(Color.parseColor("#151D27"));
                bar.setPadding(dp(14), dp(10), dp(10), dp(10));

                TextView tv = new TextView(getContext());
                tv.setText(title);
                tv.setTextColor(Color.parseColor("#EDF2F7"));
                tv.setTextSize(15);
                LinearLayout.LayoutParams tvLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
                tv.setLayoutParams(tvLp);

                Button done = new Button(getContext());
                done.setText(silent ? "取消" : "完成");
                done.setOnClickListener(v -> closeOverlayAnimated(null, null));

                bar.addView(tv);
                bar.addView(done);

                WebView wv = buildWebView();
                wv.setBackgroundColor(Color.WHITE);
                wv.setFocusable(true);
                wv.setFocusableInTouchMode(true);
                configureOverlayInsets(root, bar, wv);
                // 常规可见登录页用手机 UA 方便操作；学习通静默驱动（含二维码/短信模板）按 desktopUa 使用桌面 UA
                wv.getSettings().setUserAgentString(desktopUa ? UA : null);
                wv.getSettings().setUseWideViewPort(true);
                wv.getSettings().setLoadWithOverviewMode(true);
                wv.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageStarted(WebView view, String u, Bitmap f) {
                        overlayUrl = u != null ? u : "";
                    }

                    @Override
                    public void onPageFinished(WebView view, String u) {
                        if (u != null && u.equals(view.getUrl()) && !overlayUrl.startsWith("load-error:")) overlayUrl = u;
                    }

                    @Override
                    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                        if (request != null && request.isForMainFrame()) {
                            String upgraded = upgradeChaoxingHttp(request.getUrl());
                            if (upgraded != null) {
                                android.util.Log.i("SchoolBrowser", "upgrading cleartext Chaoxing redirect to HTTPS");
                                overlayUrl = upgraded;
                                view.loadUrl(upgraded);
                                return;
                            }
                            if (silent) {
                                int code = error != null ? error.getErrorCode() : WebViewClient.ERROR_UNKNOWN;
                                android.util.Log.w("SchoolBrowser", "silent mainFrame error code=" + code);
                                // ERROR_UNKNOWN (-1) 常由页面重定向或脚本跳转中断前一个导航触发，不应判为网络故障
                                if (code != WebViewClient.ERROR_UNKNOWN) {
                                    overlayUrl = "load-error:" + code;
                                }
                            }
                        }
                    }

                    @Override
                    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                        if (req != null && req.isForMainFrame()) {
                            String upgraded = upgradeChaoxingHttp(req.getUrl());
                            if (upgraded != null) {
                                overlayUrl = upgraded;
                                view.loadUrl(upgraded);
                                return true;
                            }
                        }
                        // 常规 http/https 交由 WebView 原生继续导航，保留 Referer 与 POST 上下文；
                        // 仅拦截非 http/https 外部协议，避免出现 ERR_UNKNOWN_URL_SCHEME。
                        return !isHttpOrHttps(req);
                    }
                });
                overlayUrl = url;
                wv.loadUrl(url);

                root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
                root.addView(wv, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

                root.setAlpha(0f);
                root.setTranslationY(dp(44));
                if (silent) root.setVisibility(View.INVISIBLE);
                getActivity().addContentView(root, new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                ViewCompat.requestApplyInsets(root);
                overlay = root;
                overlayBar = bar;
                overlayTitleView = tv;
                overlayView = wv;
                overlayClosing = false;
                authOverlay = silent;
                overlayVisible = !silent;
                if (!silent) animateOverlayIn(root);

                // 登录窗开着的时候定时落盘：用户可能登录完直接把 App 划掉，
                // 这时候 Cookie（CAS 的 TGC / webvpn 的 sid）还在内存里，会丢。
                overlayFlusher = new Runnable() {
                    @Override
                    public void run() {
                        if (overlay == null) return;
                        flushCookies();
                        main.postDelayed(this, 3000);
                    }
                };
                main.postDelayed(overlayFlusher, 3000);

                JSObject ret = new JSObject();
                ret.put("shown", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("open failed: " + e.getMessage());
            }
        });
    }

    private void configureOverlayInsets(LinearLayout root, LinearLayout bar, WebView webView) {
        class OverlayInsets {
            private final int[] location = new int[2];
            private final Rect visibleFrame = new Rect();
            private final int minWebHeight = dp(96);
            private int unobscuredBottom;
            private Insets nav = Insets.NONE;
            private Insets sides = Insets.NONE;
            private int imeBottom;

            void applyPadding() {
                if (root.getHeight() == 0) return;
                View decor = root.getRootView();
                decor.getLocationOnScreen(location);
                int decorBottom = location[1] + decor.getHeight();
                if (imeBottom == 0) unobscuredBottom = decorBottom;

                int bottom = nav.bottom;
                if (imeBottom > 0) {
                    int windowBottom;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        windowBottom = getActivity().getWindowManager().getCurrentWindowMetrics().getBounds().bottom;
                    } else if (unobscuredBottom > 0) {
                        windowBottom = Math.max(unobscuredBottom, decorBottom);
                    } else {
                        root.getWindowVisibleDisplayFrame(visibleFrame);
                        windowBottom = Math.max(decorBottom, visibleFrame.bottom + imeBottom);
                    }

                    root.getLocationOnScreen(location);
                    int overlayBottom = location[1] - Math.round(root.getTranslationY()) + root.getHeight();
                    int alreadyResizedByParent = Math.max(0, windowBottom - overlayBottom);
                    bottom = Math.max(bottom, Math.max(0, imeBottom - alreadyResizedByParent));
                }

                int maxPadding = Math.max(0, root.getHeight() - bar.getMeasuredHeight() - minWebHeight);
                bottom = Math.min(bottom, maxPadding);
                if (root.getPaddingLeft() != sides.left || root.getPaddingRight() != sides.right
                        || root.getPaddingBottom() != bottom) {
                    root.setPadding(sides.left, 0, sides.right, bottom);
                    webView.requestLayout();
                }
            }
        }

        OverlayInsets insets = new OverlayInsets();
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, windowInsets) -> {
            Insets top = windowInsets.getInsets(
                    WindowInsetsCompat.Type.statusBars() | WindowInsetsCompat.Type.displayCutout());
            insets.nav = windowInsets.getInsets(WindowInsetsCompat.Type.navigationBars());
            insets.sides = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            insets.imeBottom = windowInsets.getInsets(WindowInsetsCompat.Type.ime()).bottom;
            int topPadding = dp(10) + top.top;
            if (bar.getPaddingTop() != topPadding) {
                bar.setPadding(dp(14), topPadding, dp(10), dp(10));
                webView.requestLayout();
            }
            insets.applyPadding();
            return WindowInsetsCompat.CONSUMED;
        });
        // Insets may arrive before the parent has applied its IME resize.
        root.addOnLayoutChangeListener((v, l, t, r, b, oldL, oldT, oldR, oldB) -> insets.applyPadding());
    }

    private void animateOverlayIn(LinearLayout root) {
        root.animate().alpha(1f).translationY(0f).setDuration(220)
                .setInterpolator(new DecelerateInterpolator()).start();
    }

    @PluginMethod
    public void reveal(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            boolean canReveal = authOverlay && overlay != null && !overlayClosing;
            if (canReveal) {
                overlay.animate().cancel();
                overlayTitleView.setText(call.getString("title", "安全验证（完成后自动返回）"));
                overlay.setVisibility(View.VISIBLE);
                overlayVisible = true;
                animateOverlayIn(overlay);
            }
            JSObject ret = new JSObject();
            ret.put("revealed", canReveal);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void conceal(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            LinearLayout target = overlay;
            boolean canConceal = authOverlay && target != null && !overlayClosing;
            if (canConceal && overlayVisible) {
                target.animate().cancel();
                target.findFocus();
                target.clearFocus();
                android.view.inputmethod.InputMethodManager keyboard =
                        getContext().getSystemService(android.view.inputmethod.InputMethodManager.class);
                if (keyboard != null) keyboard.hideSoftInputFromWindow(target.getWindowToken(), 0);
                target.animate().alpha(0f).translationY(dp(44)).setDuration(180)
                        .setInterpolator(new AccelerateInterpolator()).withEndAction(() -> {
                            if (overlay == target && !overlayClosing) {
                                target.setVisibility(View.INVISIBLE);
                                overlayVisible = false;
                            }
                        }).start();
            }
            JSObject ret = new JSObject();
            ret.put("concealed", canConceal);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void close(PluginCall call) {
        String successMessage = call.getString("successMessage", "");
        getActivity().runOnUiThread(() -> {
            String lastUrl = overlayUrl;
            closeOverlayAnimated(successMessage, () -> {
                JSObject ret = new JSObject();
                ret.put("closed", true);
                ret.put("url", lastUrl);
                call.resolve(ret);
            });
        });
    }

    @PluginMethod
    public void isOpen(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("open", overlay != null && !overlayClosing);
        call.resolve(ret);
    }

    private void closeOverlayAnimated(String successMessage, Runnable onFinished) {
        final LinearLayout target = overlay;
        if (target == null || overlayClosing) {
            if (onFinished != null) onFinished.run();
            return;
        }
        overlayClosing = true;
        if (!overlayVisible) {
            flushCookies();
            closeOverlay();
            if (onFinished != null) onFinished.run();
            return;
        }
        flushCookies();

        Runnable slideOut = () -> {
            if (overlay != target) {
                if (onFinished != null) onFinished.run();
                return;
            }
            target.animate()
                    .alpha(0f)
                    .translationY(dp(56))
                    .setDuration(230)
                    .setInterpolator(new AccelerateInterpolator())
                    .withEndAction(() -> {
                        closeOverlay();
                        if (onFinished != null) onFinished.run();
                    })
                    .start();
        };

        if (successMessage != null && !successMessage.isEmpty()) {
            if (overlayBar != null) overlayBar.setBackgroundColor(Color.parseColor("#15803D"));
            if (overlayTitleView != null) overlayTitleView.setText(successMessage);
            main.postDelayed(slideOut, 450);
        } else {
            slideOut.run();
        }
    }

    private void closeOverlay() {
        if (overlayFlusher != null) {
            main.removeCallbacks(overlayFlusher);
            overlayFlusher = null;
        }
        if (overlayView != null) {
            overlayView.stopLoading();
            overlayView.setWebViewClient(null);
        }
        if (overlay != null) {
            overlay.animate().cancel();
            ViewGroup parent = (ViewGroup) overlay.getParent();
            if (parent != null) parent.removeView(overlay);
            overlay = null;
        }
        overlayBar = null;
        overlayTitleView = null;
        overlayClosing = false;
        authOverlay = false;
        overlayVisible = false;
        flushCookies();
        if (overlayView != null) {
            overlayView.removeAllViews();
            overlayView.destroy();
            overlayView = null;
        }
        overlayUrl = "";
    }

    @PluginMethod
    public void saveImageToGallery(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                && getPermissionState("legacyGallery") != PermissionState.GRANTED) {
            requestPermissionForAlias("legacyGallery", call, "galleryPermissionResult");
            return;
        }
        writeGalleryImage(call);
    }

    @PermissionCallback
    private void galleryPermissionResult(PluginCall call) {
        if (getPermissionState("legacyGallery") == PermissionState.GRANTED) {
            writeGalleryImage(call);
        } else {
            galleryResult(call, false, "未获得相册写入权限");
        }
    }

    private void galleryResult(PluginCall call, boolean saved, String message) {
        JSObject result = new JSObject();
        result.put("saved", saved);
        if (message != null) result.put("message", message);
        call.resolve(result);
    }

    private void writeGalleryImage(PluginCall call) {
        getBridge().execute(() -> {
            ContentResolver resolver = getContext().getContentResolver();
            Uri image = null;
            try {
                String data = call.getString("dataUrl", "");
                int comma = data.indexOf(',');
                String header = comma < 0 ? "" : data.substring(0, comma);
                boolean png = header.equals("data:image/png;base64");
                if ((!png && !header.equals("data:image/jpeg;base64")) || data.length() > 12_000_000) {
                    galleryResult(call, false, "仅支持 PNG 或 JPEG 图片");
                    return;
                }
                byte[] bytes = Base64.decode(data.substring(comma + 1), Base64.DEFAULT);
                BitmapFactory.Options bounds = new BitmapFactory.Options();
                bounds.inJustDecodeBounds = true;
                BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
                String mime = png ? "image/png" : "image/jpeg";
                if (!mime.equals(bounds.outMimeType) || bounds.outWidth <= 0 || bounds.outHeight <= 0) {
                    galleryResult(call, false, "图片数据无效");
                    return;
                }
                String name = call.getString("filename", "KeXiaoMiao-" + System.currentTimeMillis())
                        .replaceFirst("(?i)\\.(png|jpe?g)$", "").replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
                if (name.isEmpty() || name.startsWith(".")) name = "KeXiaoMiao-" + System.currentTimeMillis();
                name = name.substring(0, Math.min(name.length(), 80)) + (png ? ".png" : ".jpg");
                ContentValues values = new ContentValues();
                values.put(MediaStore.Images.Media.DISPLAY_NAME, name);
                values.put(MediaStore.Images.Media.MIME_TYPE, mime);
                boolean scoped = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q;
                if (scoped) {
                    values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/KeXiaoMiao");
                    values.put(MediaStore.Images.Media.IS_PENDING, 1);
                }
                image = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                if (image == null) throw new IOException("gallery insert failed");
                try (OutputStream output = resolver.openOutputStream(image)) {
                    if (output == null) throw new IOException("gallery stream unavailable");
                    output.write(bytes);
                }
                if (scoped) {
                    values.clear();
                    values.put(MediaStore.Images.Media.IS_PENDING, 0);
                    if (resolver.update(image, values, null, null) != 1) throw new IOException("gallery publish failed");
                }
                galleryResult(call, true, null);
            } catch (Exception e) {
                if (image != null) {
                    try { resolver.delete(image, null, null); } catch (RuntimeException ignored) {}
                }
                galleryResult(call, false, "无法保存图片到相册");
            }
        });
    }

    /**
     * 在可见登录窗里跑一段 JS。
     * 教务 CAS 回来后经常停在「统一身份认证登录」落地页，要再点一次「登录」才进系统，
     * 桌面版有这一步（autologin 的 landing 点击），安卓这边靠它在登录窗里点。
     */
    @PluginMethod
    public void evalOverlay(PluginCall call) {
        String js = call.getString("js", "true");
        final WebView wv = overlayView;
        if (wv == null) {
            call.reject("overlay not open");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                wv.evaluateJavascript(js, value -> {
                    JSObject ret = new JSObject();
                    ret.put("value", unquote(value));
                    call.resolve(ret);
                });
            } catch (Exception e) {
                call.reject("evalOverlay failed: " + e.getMessage());
            }
        });
    }

    /** 把 Cookie 立刻写盘（WebView 默认只在合适的时机异步刷，进程被杀就没了） */
    private void flushCookies() {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            main.post(this::flushCookies);
            return;
        }
        try {
            CookieManager.getInstance().flush();
        } catch (RuntimeException ignored) {
        }
    }

    /* ---------------- 隐藏 WebView ---------------- */

    private boolean isCloudPaymentUrl(String value) {
        Uri uri = Uri.parse(value);
        return "https".equals(uri.getScheme()) && "h5cloud.17wanxiao.com".equals(uri.getHost())
                && uri.getPort() == 18443 && uri.getUserInfo() == null && uri.getPath() != null
                && uri.getPath().startsWith("/CloudPayment/");
    }

    private boolean isWanxiaoAuthAllowedUrl(String value) {
        if (value == null || value.isEmpty()) return false;
        Uri uri = Uri.parse(value);
        if (!"https".equalsIgnoreCase(uri.getScheme())) return false;
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
        return "hub.17wanxiao.com".equals(host)
                || "open.17wanxiao.com".equals(host)
                || ("h5cloud.17wanxiao.com".equals(host) && uri.getPort() == 18443);
    }

    /** CapacitorHttp otherwise reads and writes the default WebView cookie jar automatically. */
    private static final class AirconCookieHandler extends CookieHandler {
        private final CookieHandler delegate;

        AirconCookieHandler(CookieHandler delegate) { this.delegate = delegate; }

        private boolean isCloudPayment(URI uri) {
            return uri != null && "https".equalsIgnoreCase(uri.getScheme())
                    && "h5cloud.17wanxiao.com".equalsIgnoreCase(uri.getHost()) && uri.getPort() == 18443
                    && uri.getPath() != null && uri.getPath().startsWith("/CloudPayment/");
        }

        @Override
        public Map<String, List<String>> get(URI uri, Map<String, List<String>> headers) throws IOException {
            return delegate == null || isCloudPayment(uri) ? Collections.emptyMap() : delegate.get(uri, headers);
        }

        @Override
        public void put(URI uri, Map<String, List<String>> headers) throws IOException {
            if (delegate != null && !isCloudPayment(uri)) delegate.put(uri, headers);
        }
    }

    private void ensureAirconHttpIsolated() {
        synchronized (AirconCookieHandler.class) {
            CookieHandler existing = CookieHandler.getDefault();
            if (!(existing instanceof AirconCookieHandler)) {
                CookieHandler.setDefault(new AirconCookieHandler(existing));
            }
        }
    }

    @PluginMethod
    public void isolateAirconHttp(PluginCall call) {
        ensureAirconHttpIsolated();
        call.resolve();
    }

    /**
     * 专供 17wanxiao 云缴费使用的隔离 HTTP GET：
     * 直接走 HttpURLConnection（禁用自动重定向与系统 CookieJar），原样透传请求头并按列表返回全部 Set-Cookie。
     */
    @PluginMethod
    public void airconHttp(PluginCall call) {
        String urlStr = call.getString("url", "");
        JSObject headersObj = call.getObject("headers", new JSObject());
        if (!isCloudPaymentUrl(urlStr)) {
            call.reject("Unsupported CloudPayment url");
            return;
        }
        ensureAirconHttpIsolated();
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                URL target = new URL(urlStr);
                conn = (HttpURLConnection) target.openConnection();
                conn.setRequestMethod("GET");
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(12_000);
                conn.setReadTimeout(12_000);
                conn.setUseCaches(false);
                if (headersObj != null) {
                    Iterator<String> keys = headersObj.keys();
                    while (keys.hasNext()) {
                        String key = keys.next();
                        String value = headersObj.optString(key, "");
                        if (key != null && !key.isEmpty() && value != null && !value.isEmpty()) {
                            conn.setRequestProperty(key, value);
                        }
                    }
                }
                int status = conn.getResponseCode();
                InputStream stream = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                String body = "";
                if (stream != null) {
                    try (InputStream in = stream; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                        byte[] buf = new byte[4096];
                        int n;
                        while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                        body = out.toString(StandardCharsets.UTF_8.name());
                    }
                }
                String location = "";
                JSArray setCookies = new JSArray();
                Map<String, List<String>> respHeaders = conn.getHeaderFields();
                if (respHeaders != null) {
                    for (Map.Entry<String, List<String>> entry : respHeaders.entrySet()) {
                        String k = entry.getKey();
                        List<String> vals = entry.getValue();
                        if (k == null || vals == null) continue;
                        if ("set-cookie".equalsIgnoreCase(k)) {
                            for (String v : vals) {
                                if (v != null && !v.isEmpty()) setCookies.put(v);
                            }
                        } else if ("location".equalsIgnoreCase(k) && !vals.isEmpty()) {
                            location = vals.get(0);
                        }
                    }
                }
                JSObject ret = new JSObject();
                ret.put("status", status);
                ret.put("data", body);
                ret.put("location", location);
                ret.put("setCookies", setCookies);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("airconHttp failed: " + e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    /** 清理默认 CookieManager 中 h5cloud.17wanxiao.com 域的 Cookie */
    private void clearAirconDomainCookies(CookieManager jar, String cookieUrl) {
        String[] urls = new String[]{cookieUrl, "https://h5cloud.17wanxiao.com:18443/CloudPayment/", "https://h5cloud.17wanxiao.com:18443/"};
        Set<String> names = new LinkedHashSet<>();
        for (String u : urls) {
            String raw = jar.getCookie(u);
            if (raw == null || raw.isEmpty()) continue;
            for (String pair : raw.split(";")) {
                int eq = pair.indexOf('=');
                if (eq <= 0) continue;
                String name = pair.substring(0, eq).trim();
                if (!name.isEmpty()) names.add(name);
            }
        }
        String[] paths = new String[]{"/CloudPayment", "/CloudPayment/", "/"};
        for (String name : names) {
            for (String p : paths) {
                String expired = name + "=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=" + p;
                jar.setCookie("https://h5cloud.17wanxiao.com:18443/", expired);
                jar.setCookie("https://h5cloud.17wanxiao.com:18443/", expired + "; Domain=h5cloud.17wanxiao.com");
            }
        }
        jar.flush();
    }

    /** 恢复默认 CookieManager 中备份的 h5cloud.17wanxiao.com 域 Cookie */
    private void restoreAirconDomainCookies(CookieManager jar, String cookieUrl, String backup) {
        clearAirconDomainCookies(jar, cookieUrl);
        if (backup != null && !backup.isEmpty()) {
            for (String pair : backup.split(";")) {
                String trimmed = pair.trim();
                if (!trimmed.isEmpty() && trimmed.contains("=")) {
                    jar.setCookie(cookieUrl, trimmed + "; Path=/CloudPayment");
                }
            }
        }
        jar.flush();
    }

    @PluginMethod
    @SuppressLint("SetJavaScriptEnabled")
    public void bootstrapAircon(PluginCall call) {
        String project = call.getString("project", "");
        String cookieUrl = call.getString("cookieUrl", "");
        String userAgent = call.getString("userAgent", "");
        if (!isCloudPaymentUrl(project) || !isCloudPaymentUrl(cookieUrl)
                || !"/CloudPayment/bill/selectPayProject.do".equals(Uri.parse(project).getPath())
                || !"/CloudPayment/user/checkRoomCount.do".equals(Uri.parse(cookieUrl).getPath())) {
            call.reject("Unsupported CloudPayment bootstrap");
            return;
        }

        main.post(() -> {
            final boolean multiProfile = WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE);
            WebView view = new WebView(getContext());
            try {
                final CookieManager jar;
                final String backupCookies;
                if (multiProfile) {
                    String profile = "haust-cloudpayment-anonymous";
                    WebViewCompat.setProfile(view, profile);
                    jar = ProfileStore.getInstance().getOrCreateProfile(profile).getCookieManager();
                    backupCookies = null;
                } else {
                    jar = CookieManager.getInstance();
                    jar.setAcceptCookie(true);
                    jar.setAcceptThirdPartyCookies(view, true);
                    backupCookies = jar.getCookie(cookieUrl);
                }
                AtomicBoolean finished = new AtomicBoolean();
                AtomicInteger httpStatus = new AtomicInteger(0);
                java.util.function.BiConsumer<String, String> finish = (cookies, err) -> {
                    if (!finished.compareAndSet(false, true)) return;
                    view.stopLoading();
                    view.setWebViewClient(null);
                    if (view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
                    view.removeAllViews();
                    view.destroy();
                    if (multiProfile) {
                        jar.removeAllCookies(null);
                    } else {
                        restoreAirconDomainCookies(jar, cookieUrl, backupCookies);
                    }
                    JSObject ret = new JSObject();
                    ret.put("cookies", cookies == null ? "" : cookies);
                    ret.put("mode", multiProfile ? "multi-profile" : "default-cookie-backup");
                    if (httpStatus.get() > 0) ret.put("httpStatus", httpStatus.get());
                    if (err != null && !err.isEmpty()) ret.put("error", err);
                    call.resolve(ret);
                };
                view.getSettings().setJavaScriptEnabled(true);
                view.getSettings().setDomStorageEnabled(true);
                view.getSettings().setUserAgentString(userAgent);
                view.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView wv, WebResourceRequest request) {
                        return request.isForMainFrame() && !isCloudPaymentUrl(request.getUrl().toString());
                    }

                    @Override
                    public void onReceivedHttpError(WebView wv, WebResourceRequest request, WebResourceResponse error) {
                        if (request.isForMainFrame()) {
                            int code = error != null ? error.getStatusCode() : 0;
                            httpStatus.set(code);
                            main.post(() -> finish.accept("", "HTTP " + code));
                        }
                    }

                    @Override
                    public void onReceivedError(WebView wv, WebResourceRequest request, WebResourceError error) {
                        if (request != null && request.isForMainFrame()) {
                            String desc = error != null && error.getDescription() != null
                                    ? error.getDescription().toString() : "network-error";
                            main.post(() -> finish.accept("", desc));
                        }
                    }

                    @Override
                    public void onPageFinished(WebView wv, String url) {
                        main.postDelayed(() -> {
                            if (finished.get()) return;
                            String current = wv.getUrl();
                            if (url.equals(current) && isCloudPaymentUrl(current)) {
                                finish.accept(jar.getCookie(cookieUrl), "");
                            }
                        }, 800);
                    }
                });
                view.setVisibility(View.INVISIBLE);
                getActivity().addContentView(view, new FrameLayout.LayoutParams(1, 1));
                main.postDelayed(() -> finish.accept("", "timeout"), 12_000);
                if (multiProfile) {
                    jar.removeAllCookies(removed -> {
                        if (!finished.get()) view.loadUrl(project);
                    });
                } else {
                    clearAirconDomainCookies(jar, cookieUrl);
                    if (!finished.get()) view.loadUrl(project);
                }
            } catch (RuntimeException exception) {
                view.stopLoading();
                if (view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
                view.destroy();
                JSObject ret = new JSObject();
                ret.put("cookies", "");
                ret.put("error", String.valueOf(exception.getMessage()));
                call.resolve(ret);
            }
        });
    }

    /**
     * 空调电费（17wanxiao）隔离 WebView 同源执行兜底：
     * 使用真实 Chromium TLS 栈加载 selectPayProject.do，并在同源上下文顺序执行
     * checkRoomCount.do 与 getRoom.do / getRoomState.do，绕过非浏览器 TLS 握手重置。
     */
    @PluginMethod
    @SuppressLint("SetJavaScriptEnabled")
    public void airconWebViewRequest(PluginCall call) {
        String project = call.getString("project", "");
        String activateUrl = call.getString("activateUrl", "");
        String targetUrl = call.getString("targetUrl", "");
        String userAgent = call.getString("userAgent", "");
        if (!isCloudPaymentUrl(project) || !isCloudPaymentUrl(activateUrl) || !isCloudPaymentUrl(targetUrl)) {
            call.reject("Unsupported CloudPayment webview request");
            return;
        }
        String targetPath = Uri.parse(targetUrl).getPath();
        if (!"/CloudPayment/user/getRoom.do".equals(targetPath)
                && !"/CloudPayment/user/getRoomState.do".equals(targetPath)) {
            call.reject("Unsupported CloudPayment target path");
            return;
        }

        main.post(() -> {
            final boolean multiProfile = WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE);
            WebView view = new WebView(getContext());
            try {
                final CookieManager jar;
                final String backupCookies;
                if (multiProfile) {
                    String profile = "haust-cloudpayment-anonymous";
                    WebViewCompat.setProfile(view, profile);
                    jar = ProfileStore.getInstance().getOrCreateProfile(profile).getCookieManager();
                    backupCookies = null;
                } else {
                    jar = CookieManager.getInstance();
                    jar.setAcceptCookie(true);
                    jar.setAcceptThirdPartyCookies(view, true);
                    backupCookies = jar.getCookie(activateUrl);
                }
                AtomicBoolean finished = new AtomicBoolean();
                AtomicBoolean injected = new AtomicBoolean();
                java.util.function.BiConsumer<Integer, String> finish = (statusCode, payload) -> {
                    if (!finished.compareAndSet(false, true)) return;
                    view.stopLoading();
                    view.setWebViewClient(null);
                    if (view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
                    view.removeAllViews();
                    view.destroy();
                    if (multiProfile) {
                        jar.removeAllCookies(null);
                    } else {
                        restoreAirconDomainCookies(jar, activateUrl, backupCookies);
                    }
                    JSObject ret = new JSObject();
                    ret.put("status", statusCode);
                    ret.put("data", payload == null ? "" : payload);
                    ret.put("mode", multiProfile ? "webview-multi-profile" : "webview-default-backup");
                    call.resolve(ret);
                };

                final String execJs = "(() => {"
                        + "window.__haustAirconResp = null;"
                        + "const req = (u, cb) => {"
                        + "  const x = new XMLHttpRequest();"
                        + "  x.open('GET', u, true);"
                        + "  x.setRequestHeader('X-Requested-With', 'XMLHttpRequest');"
                        + "  x.onreadystatechange = () => {"
                        + "    if (x.readyState === 4) cb(x.status || 0, x.responseText || '');"
                        + "  };"
                        + "  x.onerror = () => cb(0, 'xhr-network-error');"
                        + "  x.send(null);"
                        + "};"
                        + "req(" + org.json.JSONObject.quote(activateUrl) + ", (s1, d1) => {"
                        + "  if (s1 < 200 || s1 >= 300) {"
                        + "    window.__haustAirconResp = JSON.stringify({ status: s1 || 503, data: d1 || 'checkRoomCount failed' });"
                        + "    return;"
                        + "  }"
                        + "  req(" + org.json.JSONObject.quote(targetUrl) + ", (s2, d2) => {"
                        + "    window.__haustAirconResp = JSON.stringify({ status: s2 || 503, data: d2 || '' });"
                        + "  });"
                        + "});"
                        + "return 'ok';"
                        + "})()";

                final Runnable poller = new Runnable() {
                    @Override
                    public void run() {
                        if (finished.get()) return;
                        view.evaluateJavascript("window.__haustAirconResp || ''", val -> {
                            if (finished.get()) return;
                            Object raw = unquote(val);
                            String str = raw == null ? "" : String.valueOf(raw);
                            if (!str.isEmpty()) {
                                try {
                                    org.json.JSONObject obj = new org.json.JSONObject(str);
                                    finish.accept(obj.optInt("status", 503), obj.optString("data", ""));
                                } catch (Exception e) {
                                    finish.accept(503, str);
                                }
                            } else {
                                main.postDelayed(this, 250);
                            }
                        });
                    }
                };

                view.getSettings().setJavaScriptEnabled(true);
                view.getSettings().setDomStorageEnabled(true);
                view.getSettings().setUserAgentString(userAgent);
                view.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView wv, WebResourceRequest request) {
                        return request.isForMainFrame() && !isCloudPaymentUrl(request.getUrl().toString());
                    }

                    @Override
                    public void onReceivedHttpError(WebView wv, WebResourceRequest request, WebResourceResponse error) {
                        if (request.isForMainFrame()) {
                            int code = error != null ? error.getStatusCode() : 503;
                            main.post(() -> finish.accept(code, "{\"msg\":\"云缴费 WebView 入口返回 HTTP " + code + "\"}"));
                        }
                    }

                    @Override
                    public void onReceivedError(WebView wv, WebResourceRequest request, WebResourceError error) {
                        if (request != null && request.isForMainFrame()) {
                            String desc = error != null && error.getDescription() != null
                                    ? error.getDescription().toString() : "network-error";
                            main.post(() -> finish.accept(503, "{\"msg\":\"云缴费 WebView 连接失败（" + desc + "）\"}"));
                        }
                    }

                    @Override
                    public void onPageFinished(WebView wv, String url) {
                        if (!isCloudPaymentUrl(url)) return;
                        if (!injected.compareAndSet(false, true)) return;
                        main.postDelayed(() -> {
                            if (finished.get()) return;
                            wv.evaluateJavascript(execJs, v -> main.postDelayed(poller, 250));
                        }, 600);
                    }
                });
                view.setVisibility(View.INVISIBLE);
                getActivity().addContentView(view, new FrameLayout.LayoutParams(1, 1));
                main.postDelayed(() -> finish.accept(504, "{\"msg\":\"云缴费 WebView 查询超时\"}"), 15_000);
                if (multiProfile) {
                    jar.removeAllCookies(removed -> {
                        if (!finished.get()) view.loadUrl(project);
                    });
                } else {
                    clearAirconDomainCookies(jar, activateUrl);
                    if (!finished.get()) view.loadUrl(project);
                }
            } catch (RuntimeException exception) {
                view.stopLoading();
                if (view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
                view.destroy();
                JSObject ret = new JSObject();
                ret.put("status", 503);
                ret.put("data", "{\"msg\":\"云缴费 WebView 异常：" + String.valueOf(exception.getMessage()) + "\"}");
                call.resolve(ret);
            }
        });
    }

    /**
     * 使用 cas.haust.edu.cn 公开 RSA 公钥 (/cas/jwt/publicKey) 加密密码（__RSA__ + Base64），
     * 调用标准树维 /token/password/passwordLogin 换取 30 天有效的 idToken。
     */
    @PluginMethod
    public void casTokenLogin(PluginCall call) {
        String username = call.getString("username", "");
        String password = call.getString("password", "");
        String deviceId = call.getString("deviceId", "");
        if (username.isEmpty() || password.isEmpty() || deviceId.isEmpty()) {
            call.reject("username, password and deviceId are required");
            return;
        }
        new Thread(() -> {
            HttpURLConnection keyConn = null;
            HttpURLConnection loginConn = null;
            try {
                // 1. 拉取公开 RSA 公钥
                keyConn = (HttpURLConnection) new URL("https://cas.haust.edu.cn/cas/jwt/publicKey").openConnection();
                keyConn.setRequestMethod("GET");
                keyConn.setConnectTimeout(10_000);
                keyConn.setReadTimeout(10_000);
                int keyStatus = keyConn.getResponseCode();
                if (keyStatus < 200 || keyStatus >= 300) {
                    call.reject("publicKey HTTP " + keyStatus);
                    return;
                }
                String pem;
                try (InputStream in = keyConn.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                    byte[] buf = new byte[2048];
                    int n;
                    while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                    pem = out.toString(StandardCharsets.UTF_8.name());
                }
                String base64Key = pem
                        .replace("-----BEGIN PUBLIC KEY-----", "")
                        .replace("-----END PUBLIC KEY-----", "")
                        .replaceAll("\\s+", "");
                byte[] keyBytes = android.util.Base64.decode(base64Key, android.util.Base64.DEFAULT);
                PublicKey pubKey = KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(keyBytes));
                Cipher cipher = Cipher.getInstance("RSA/ECB/PKCS1Padding");
                cipher.init(Cipher.ENCRYPT_MODE, pubKey);
                byte[] encrypted = cipher.doFinal(password.getBytes(StandardCharsets.UTF_8));
                String encodedPassword = "__RSA__" + android.util.Base64.encodeToString(encrypted, android.util.Base64.NO_WRAP);

                // 2. 提交标准表单换取 idToken
                String form = "username=" + URLEncoder.encode(username, "UTF-8")
                        + "&password=" + URLEncoder.encode(encodedPassword, "UTF-8")
                        + "&appId=" + URLEncoder.encode("com.lantu.MobileCampus.haust", "UTF-8")
                        + "&geo="
                        + "&deviceId=" + URLEncoder.encode(deviceId, "UTF-8")
                        + "&osType=android"
                        + "&clientId=";
                byte[] payload = form.getBytes(StandardCharsets.UTF_8);

                loginConn = (HttpURLConnection) new URL("https://cas.haust.edu.cn/token/password/passwordLogin").openConnection();
                loginConn.setRequestMethod("POST");
                loginConn.setDoOutput(true);
                loginConn.setInstanceFollowRedirects(false);
                loginConn.setConnectTimeout(12_000);
                loginConn.setReadTimeout(12_000);
                loginConn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
                loginConn.setRequestProperty("Accept", "application/json");
                try (OutputStream os = loginConn.getOutputStream()) {
                    os.write(payload);
                    os.flush();
                }
                int status = loginConn.getResponseCode();
                InputStream respStream = status >= 400 ? loginConn.getErrorStream() : loginConn.getInputStream();
                String body = "";
                if (respStream != null) {
                    try (InputStream in = respStream; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                        byte[] buf = new byte[4096];
                        int n;
                        while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                        body = out.toString(StandardCharsets.UTF_8.name());
                    }
                }
                JSObject ret = new JSObject();
                ret.put("status", status);
                ret.put("data", body);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("casTokenLogin failed: " + e.getMessage());
            } finally {
                if (keyConn != null) keyConn.disconnect();
                if (loginConn != null) loginConn.disconnect();
            }
        }).start();
    }

    /**
     * 使用 cas.haust.edu.cn 签发的 idToken，在隔离 WebView 中完成
     * hub.17wanxiao.com → open.17wanxiao.com → h5cloud.17wanxiao.com:18443/CloudPayment/user/pay.do
     * 认证链，并提取已认证的 SESSION Cookie（支持可选直接同源执行目标查询）。
     */
    @PluginMethod
    @SuppressLint("SetJavaScriptEnabled")
    public void airconAuthBootstrap(PluginCall call) {
        String idToken = call.getString("idToken", "");
        String userAgent = call.getString("userAgent", "");
        String cookieUrl = call.getString("cookieUrl", "https://h5cloud.17wanxiao.com:18443/CloudPayment/user/checkRoomCount.do?schoolCode=1007");
        if (idToken == null || idToken.isEmpty() || !isCloudPaymentUrl(cookieUrl)) {
            call.reject("idToken and valid cookieUrl are required");
            return;
        }
        final String startUrl = "https://hub.17wanxiao.com/bsacs/light.action?flag=supwisdomapp_hnkjdxjf&ecardFunc=index&token="
                + Uri.encode(idToken);

        main.post(() -> {
            final boolean multiProfile = WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE);
            WebView view = new WebView(getContext());
            try {
                final CookieManager jar;
                final String backupCookies;
                if (multiProfile) {
                    String profile = "haust-cloudpayment-anonymous";
                    WebViewCompat.setProfile(view, profile);
                    jar = ProfileStore.getInstance().getOrCreateProfile(profile).getCookieManager();
                    backupCookies = null;
                } else {
                    jar = CookieManager.getInstance();
                    jar.setAcceptCookie(true);
                    jar.setAcceptThirdPartyCookies(view, true);
                    backupCookies = jar.getCookie(cookieUrl);
                }
                AtomicBoolean finished = new AtomicBoolean();
                java.util.function.BiConsumer<String, String> finish = (cookies, err) -> {
                    if (!finished.compareAndSet(false, true)) return;
                    view.stopLoading();
                    view.setWebViewClient(null);
                    if (view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
                    view.removeAllViews();
                    view.destroy();
                    if (multiProfile) {
                        jar.removeAllCookies(null);
                    } else {
                        restoreAirconDomainCookies(jar, cookieUrl, backupCookies);
                    }
                    JSObject ret = new JSObject();
                    ret.put("cookies", cookies == null ? "" : cookies);
                    ret.put("mode", multiProfile ? "auth-multi-profile" : "auth-default-backup");
                    if (err != null && !err.isEmpty()) ret.put("error", err);
                    call.resolve(ret);
                };

                view.getSettings().setJavaScriptEnabled(true);
                view.getSettings().setDomStorageEnabled(true);
                if (userAgent != null && !userAgent.isEmpty()) {
                    view.getSettings().setUserAgentString(userAgent);
                }
                view.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView wv, WebResourceRequest request) {
                        if (request == null || !request.isForMainFrame()) return false;
                        return !isWanxiaoAuthAllowedUrl(request.getUrl().toString());
                    }

                    @Override
                    public void onReceivedError(WebView wv, WebResourceRequest request, WebResourceError error) {
                        if (request != null && request.isForMainFrame()) {
                            String desc = error != null && error.getDescription() != null
                                    ? error.getDescription().toString() : "network-error";
                            main.post(() -> finish.accept("", desc));
                        }
                    }

                    @Override
                    public void onPageFinished(WebView wv, String url) {
                        if (!isCloudPaymentUrl(url)) return;
                        main.postDelayed(() -> {
                            if (finished.get()) return;
                            String current = wv.getUrl();
                            if (isCloudPaymentUrl(current)) {
                                String c = jar.getCookie(cookieUrl);
                                if (c != null && (c.contains("SESSION=") || c.contains("JSESSIONID="))) {
                                    finish.accept(c, "");
                                }
                            }
                        }, 800);
                    }
                });
                view.setVisibility(View.INVISIBLE);
                getActivity().addContentView(view, new FrameLayout.LayoutParams(1, 1));
                main.postDelayed(() -> finish.accept("", "auth-bootstrap-timeout"), 18_000);
                if (multiProfile) {
                    jar.removeAllCookies(removed -> {
                        if (!finished.get()) view.loadUrl(startUrl);
                    });
                } else {
                    clearAirconDomainCookies(jar, cookieUrl);
                    if (!finished.get()) view.loadUrl(startUrl);
                }
            } catch (RuntimeException exception) {
                view.stopLoading();
                if (view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
                view.destroy();
                JSObject ret = new JSObject();
                ret.put("cookies", "");
                ret.put("error", String.valueOf(exception.getMessage()));
                call.resolve(ret);
            }
        });
    }

    @PluginMethod
    public void load(PluginCall call) {
        String url = call.getString("url");
        int timeout = call.getInt("timeoutMs", 45000);
        String referer = call.getString("referer", "");
        String idToken = call.getString("idToken", "");
        if (url == null || url.isEmpty()) {
            call.reject("url required");
            return;
        }
        if (idToken != null && !idToken.isEmpty()) {
            Uri parsed = Uri.parse(url);
            int port = parsed.getPort();
            String path = parsed.getPath();
            boolean validCasLogin = "https".equalsIgnoreCase(parsed.getScheme())
                    && "cas.haust.edu.cn".equalsIgnoreCase(parsed.getHost())
                    && (port == -1 || port == 443)
                    && ("/cas/login".equals(path) || "/cas/login/".equals(path));
            if (!validCasLogin) {
                call.reject("idToken only allowed for https://cas.haust.edu.cn/cas/login");
                return;
            }
            // 在非重定向 HttpURLConnection 中携带 X-Id-Token 换取一次性 ticket，严禁把 X-Id-Token 暴露给 WebView 重定向链
            new Thread(() -> {
                HttpURLConnection conn = null;
                try {
                    conn = (HttpURLConnection) new URL(url).openConnection();
                    conn.setInstanceFollowRedirects(false);
                    conn.setRequestMethod("GET");
                    conn.setConnectTimeout(Math.min(12000, Math.max(5000, timeout)));
                    conn.setReadTimeout(Math.min(12000, Math.max(5000, timeout)));
                    conn.setRequestProperty("User-Agent", UA);
                    conn.setRequestProperty("X-Id-Token", idToken);
                    String casCookies = CookieManager.getInstance().getCookie("https://cas.haust.edu.cn/cas/login");
                    if (casCookies != null && !casCookies.isEmpty()) {
                        conn.setRequestProperty("Cookie", casCookies);
                    }
                    int code = conn.getResponseCode();
                    CookieManager cm = CookieManager.getInstance();
                    java.util.List<String> setCookies = conn.getHeaderFields().get("Set-Cookie");
                    if (setCookies == null) setCookies = conn.getHeaderFields().get("set-cookie");
                    if (setCookies != null) {
                        for (String sc : setCookies) {
                            if (sc != null && !sc.isEmpty()) cm.setCookie("https://cas.haust.edu.cn/", sc);
                        }
                        cm.flush();
                    }
                    String location = conn.getHeaderField("Location");
                    if (code >= 300 && code < 400 && location != null && !location.isEmpty()) {
                        Uri locUri = Uri.parse(location);
                        String locHost = locUri.getHost() != null ? locUri.getHost().toLowerCase() : "";
                        int locPort = locUri.getPort();
                        if ("https".equalsIgnoreCase(locUri.getScheme())
                                && (locPort == -1 || locPort == 443)
                                && (locHost.equals("haust.edu.cn") || locHost.endsWith(".haust.edu.cn"))) {
                            loadInHiddenWebView(location, timeout, "", call);
                            return;
                        }
                    }
                    JSObject ret = new JSObject();
                    ret.put("url", location != null ? location : url);
                    ret.put("authRequired", true);
                    call.resolve(ret);
                } catch (Exception e) {
                    JSObject ret = new JSObject();
                    ret.put("url", "load-error:-1:" + e.getMessage());
                    ret.put("error", e.getMessage());
                    call.resolve(ret);
                } finally {
                    if (conn != null) conn.disconnect();
                }
            }).start();
            return;
        }
        loadInHiddenWebView(url, timeout, referer, call);
    }

    private void loadInHiddenWebView(String url, int timeout, String referer, PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                WebView wv = ensureHidden();
                final boolean[] done = {false};
                wv.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String u) {
                        // CAS 登录会连跳好几页：等 URL 连续两次不变再回，否则会把中间页当成落地页
                        settle(view, done, call, 900);
                        flushCookies();
                    }

                    @Override
                    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                        if (request == null || !request.isForMainFrame()) return;
                        if (done[0]) return;
                        done[0] = true;
                        int code = error != null ? error.getErrorCode() : -1;
                        String desc = error != null && error.getDescription() != null
                                ? error.getDescription().toString() : "unknown";
                        String errUrl = "load-error:" + code + ":" + desc;
                        hiddenUrl = errUrl;
                        JSObject ret = new JSObject();
                        ret.put("url", errUrl);
                        ret.put("error", desc);
                        ret.put("errorCode", code);
                        call.resolve(ret);
                    }

                    @Override
                    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                        // 常规 http/https 返回 false 保留 Referer 与 POST 上下文；仅拦截非 http/https 协议
                        return !isHttpOrHttps(req);
                    }
                });
                main.postDelayed(() -> {
                    if (done[0]) return;
                    done[0] = true;
                    JSObject ret = new JSObject();
                    ret.put("url", hiddenUrl.isEmpty() ? url : hiddenUrl);
                    ret.put("timeout", true);
                    call.resolve(ret);
                }, Math.max(5000, timeout));
                hiddenUrl = url;
                if (referer != null && !referer.isEmpty()) {
                    java.util.Map<String, String> extraHeaders = new java.util.HashMap<>();
                    extraHeaders.put("Referer", referer);
                    wv.loadUrl(url, extraHeaders);
                } else {
                    wv.loadUrl(url);
                }
            } catch (Exception e) {
                call.reject("load failed: " + e.getMessage());
            }
        });
    }

    /** 轮询等待 URL 稳定（重定向链结束后）再 resolve */
    private void settle(WebView view, final boolean[] done, PluginCall call, int delay) {
        main.postDelayed(() -> {
            if (done[0]) return;
            String a = view.getUrl();
            main.postDelayed(() -> {
                if (done[0]) return;
                String b = view.getUrl();
                if (a != null && a.equals(b)) {
                    done[0] = true;
                    hiddenUrl = b;
                    flushCookies();
                    JSObject ret = new JSObject();
                    ret.put("url", b == null ? "" : b);
                    call.resolve(ret);
                } else {
                    settle(view, done, call, 700);
                }
            }, delay);
        }, delay);
    }

    @PluginMethod
    public void eval(PluginCall call) {
        String js = call.getString("js");
        if (js == null) js = "true";
        final String code = js;
        getActivity().runOnUiThread(() -> {
            try {
                WebView wv = ensureHidden();
                wv.evaluateJavascript(code, value -> {
                    JSObject ret = new JSObject();
                    ret.put("value", unquote(value));
                    call.resolve(ret);
                });
            } catch (Exception e) {
                call.reject("eval failed: " + e.getMessage());
            }
        });
    }

    /**
     * 状态栏配色：跟着 App 的浅色/深色走。
     * Android 15（targetSdk 35+）强制 edge-to-edge，状态栏本身就是透明的，
     * 露出来的是「窗口背景」——所以除了 setStatusBarColor，还要把 decor 的底色一起刷，
     * 否则顶部会留一条跟主题不搭的黑边。图标黑白由 AppearanceLight* 控制。
     */
    @PluginMethod
    public void statusBar(PluginCall call) {
        String color = call.getString("color", "#F5F7FB");
        boolean dark = call.getBoolean("dark", false);
        getActivity().runOnUiThread(() -> {
            try {
                android.view.Window w = getActivity().getWindow();
                int c = Color.parseColor(color);
                try {
                    w.setStatusBarColor(c);
                } catch (Exception ignored) {
                }
                w.getDecorView().setBackgroundColor(c);
                androidx.core.view.WindowInsetsControllerCompat ic =
                        androidx.core.view.WindowCompat.getInsetsController(w, w.getDecorView());
                ic.setAppearanceLightStatusBars(!dark);
                ic.setAppearanceLightNavigationBars(!dark);
            } catch (Exception ignored) {
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void currentUrl(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("url", overlay != null ? overlayUrl : hiddenUrl);
        ret.put("overlayUrl", overlayUrl);
        ret.put("hiddenUrl", hiddenUrl);
        call.resolve(ret);
    }

    @PluginMethod
    public void cookies(PluginCall call) {
        String url = call.getString("url", "https://haust.edu.cn/");
        String c = CookieManager.getInstance().getCookie(url);
        JSObject ret = new JSObject();
        ret.put("cookies", c == null ? "" : c);
        call.resolve(ret);
    }

    /** 用系统浏览器打开外部链接（通知原文、任务原页面） */
    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.startsWith("http")) {
            call.reject("bad url");
            return;
        }
        try {
            android.content.Intent i = new android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url));
            i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("open failed: " + e.getMessage());
        }
    }

    /** 按白名单包名唤起已安装的校方 App（如「我i科大」） */
    @PluginMethod
    public void haptic(PluginCall call) {
        String style = call.getString("style", "light");
        getActivity().runOnUiThread(() -> {
            try {
                View target = getBridge() != null ? getBridge().getWebView() : null;
                if (target == null) target = getActivity().getWindow().getDecorView();
                int feedback;
                if ("success".equals(style)) {
                    feedback = android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R
                            ? android.view.HapticFeedbackConstants.CONFIRM
                            : android.view.HapticFeedbackConstants.CONTEXT_CLICK;
                } else if ("error".equals(style)) {
                    feedback = android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R
                            ? android.view.HapticFeedbackConstants.REJECT
                            : android.view.HapticFeedbackConstants.LONG_PRESS;
                } else if ("medium".equals(style)) {
                    feedback = android.view.HapticFeedbackConstants.CONTEXT_CLICK;
                } else {
                    feedback = android.view.HapticFeedbackConstants.CLOCK_TICK;
                }
                target.performHapticFeedback(feedback, android.view.HapticFeedbackConstants.FLAG_IGNORE_VIEW_SETTING);
            } catch (Exception ignored) {
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void launchApp(PluginCall call) {
        String pkg = call.getString("packageName", "");
        if (!ALLOWED_LAUNCH_PACKAGES.contains(pkg)) {
            call.reject("unsupported package");
            return;
        }
        try {
            android.content.Intent intent = getContext().getPackageManager().getLaunchIntentForPackage(pkg);
            JSObject ret = new JSObject();
            if (intent == null) {
                ret.put("launched", false);
                ret.put("installed", false);
                call.resolve(ret);
                return;
            }
            intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            ret.put("launched", true);
            ret.put("installed", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("launch failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void clearCookies(PluginCall call) {
        main.post(() -> {
            try {
                CookieManager cm = CookieManager.getInstance();
                cm.removeAllCookies(removed -> {
                    try {
                        cm.flush();
                        JSObject ret = new JSObject();
                        ret.put("ok", true);
                        call.resolve(ret);
                    } catch (Exception e) {
                        call.reject("Could not flush cleared cookies");
                    }
                });
            } catch (Exception e) {
                call.reject("Could not clear cookies");
            }
        });
    }

    /** 只清指定学校域名的 WebView Cookie，避免退出学习通影响教务 VPN 登录态。 */
    @PluginMethod
    public void clearCookiesForHosts(PluginCall call) {
        final String hostsArg = call.getString("hosts", "");
        main.post(() -> {
            try {
                CookieManager cm = CookieManager.getInstance();
                Set<String> hosts = new LinkedHashSet<>();
                for (String host : hostsArg.split(",")) {
                    String normalized = host.trim().toLowerCase();
                    if (normalized.matches("[a-z0-9.-]+") &&
                            (normalized.equals("haust.edu.cn") || normalized.endsWith(".haust.edu.cn") ||
                             normalized.equals("chaoxing.com") || normalized.endsWith(".chaoxing.com"))) {
                        hosts.add(normalized);
                    }
                }
                List<String[]> removals = new ArrayList<>();
                Set<String> seenRemovals = new LinkedHashSet<>();
                String[] haustPaths = {"/", "/xysf/", "/xysf/aAppPage/", "/xysf/api/", "/eams/", "/cas/"};
                String[] chaoxingPaths = {"/", "/work/", "/exam-ans/", "/v2/", "/widget/", "/mycourse/"};
                for (String host : hosts) {
                    boolean isHaust = host.equals("haust.edu.cn") || host.endsWith(".haust.edu.cn");
                    String root = isHaust ? ".haust.edu.cn" : ".chaoxing.com";
                    String[] probePaths = isHaust ? haustPaths : chaoxingPaths;
                    for (String path : probePaths) {
                        String url = "https://" + host + path;
                        String cookie = cm.getCookie(url);
                        if (cookie == null || cookie.isEmpty()) continue;
                        Set<String> expirePaths = new LinkedHashSet<>();
                        expirePaths.add("/");
                        expirePaths.add(path);
                        if (path.length() > 1 && path.endsWith("/")) {
                            expirePaths.add(path.substring(0, path.length() - 1));
                        }
                        for (String pair : cookie.split(";")) {
                            int eq = pair.indexOf('=');
                            if (eq <= 0) continue;
                            String name = pair.substring(0, eq).trim();
                            if (!name.matches("[A-Za-z0-9._-]+")) continue;
                            for (String ep : expirePaths) {
                                String expired = name + "=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=" + ep;
                                String[] candidates = {
                                        expired,
                                        expired + "; Secure",
                                        expired + "; Domain=" + host,
                                        expired + "; Domain=" + host + "; Secure",
                                        expired + "; Domain=" + root,
                                        expired + "; Domain=" + root + "; Secure"
                                };
                                for (String header : candidates) {
                                    String dedupKey = url + "|" + header;
                                    if (seenRemovals.add(dedupKey)) {
                                        removals.add(new String[]{url, header});
                                    }
                                }
                            }
                        }
                    }
                }
                if (removals.isEmpty()) {
                    JSObject ret = new JSObject();
                    ret.put("ok", true);
                    call.resolve(ret);
                    return;
                }
                AtomicInteger remaining = new AtomicInteger(removals.size());
                AtomicBoolean accepted = new AtomicBoolean(true);
                for (String[] removal : removals) {
                    cm.setCookie(removal[0], removal[1], success -> {
                        if (success == null || !success) accepted.set(false);
                        if (remaining.decrementAndGet() == 0) {
                            cm.flush();
                            JSObject ret = new JSObject();
                            ret.put("ok", accepted.get());
                            call.resolve(ret);
                        }
                    });
                }
            } catch (Exception e) {
                call.reject("Could not clear selected cookies");
            }
        });
    }

    @SuppressLint("SetJavaScriptEnabled")
    private WebView buildWebView() {
        WebView wv = new WebView(getContext());
        WebSettings s = wv.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setSupportMultipleWindows(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setUserAgentString(UA);
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(wv, true);
        return wv;
    }

    /** 隐藏 WebView：挂在内容视图里但 1dp、不可见，保证换页与 JS 都能正常跑 */
    private WebView ensureHidden() {
        if (hidden != null) return hidden;
        WebView wv = buildWebView();
        getActivity().addContentView(wv, new FrameLayout.LayoutParams(1, 1));
        wv.setVisibility(View.INVISIBLE);
        hidden = wv;
        return wv;
    }

    /** evaluateJavascript 返回的是 JSON 字面量：字符串会被引号+转义包住，这里还原 */
    private Object unquote(String v) {
        if (v == null) return null;
        if ("null".equals(v)) return null;
        if (v.length() >= 2 && v.startsWith("\"") && v.endsWith("\"")) {
            try {
                return new org.json.JSONTokener(v).nextValue();
            } catch (Exception e) {
                return v.substring(1, v.length() - 1);
            }
        }
        return v;
    }

    private int dp(int v) {
        return (int) (v * getContext().getResources().getDisplayMetrics().density);
    }
}
