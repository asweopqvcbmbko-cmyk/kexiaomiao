package cn.edu.haust.campusassistant;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 数据层要用的「隐藏浏览器」插件，必须在 super.onCreate 之前注册
        registerPlugin(SchoolBrowserPlugin.class);
        registerPlugin(SchoolCredentialsPlugin.class);
        registerPlugin(AppUpdaterPlugin.class);
        super.onCreate(savedInstanceState);

        // 禁用系统级 Force Dark（鸿蒙卓易通/部分 ROM 会将深色卡片阴影反色为刺眼白光晕）
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                getWindow().getDecorView().setForceDarkAllowed(false);
            } catch (Exception ignored) {
            }
        }

        // 禁用 Android 12+ 系统级 WebView 边缘果冻拉伸与全局双指缩放，保持原生 App 1:1 手感
        if (bridge != null && bridge.getWebView() != null) {
            WebView webView = bridge.getWebView();
            webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                try {
                    webView.setForceDarkAllowed(false);
                } catch (Exception ignored) {
                }
            }
            WebSettings settings = webView.getSettings();
            settings.setSupportZoom(false);
            settings.setBuiltInZoomControls(false);
            settings.setDisplayZoomControls(false);
            if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
                WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, false);
            }
            if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
                WebSettingsCompat.setForceDark(settings, WebSettingsCompat.FORCE_DARK_OFF);
            }
        }

        // 迁移至 OnBackPressedDispatcher，兼容 Android 16 (targetSdk 36) 预测性返回手势
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                handleBackNavigation();
            }
        });
    }

    /**
     * WebView 的 Cookie 只在内存里攒着，隔一阵才异步落盘；进程被划掉 / 强停 /
     * 系统回收时会丢。登录态（CAS 的 TGC、webvpn 的 sid）全在这套 Cookie 里，
     * 丢了就得重新登录，所以离开前台时强制落一次盘。
     */
    @Override
    public void onPause() {
        flushCookies();
        super.onPause();
    }

    @Override
    public void onStop() {
        flushCookies();
        super.onStop();
    }

    /**
     * 返回键（含手势侧滑）：优先处理原生 Overlay（网页后退或关闭），
     * 再交给界面自己的「弹窗 → 子页 → 首页」逐级返回，都处理完了才退到桌面。
     */
    private void handleBackNavigation() {
        if (SchoolBrowserPlugin.handleBackPress()) return;

        WebView web = bridge != null ? bridge.getWebView() : null;
        if (web == null) {
            moveTaskToBack(true);
            return;
        }
        try {
            // 界面注册的 window.__haustBack()：处理了返回 true，没处理返回 false
            web.evaluateJavascript("(window.__haustBack&&window.__haustBack())?'1':'0'", value -> {
                boolean handled = value != null && (value.equals("\"1\"") || value.equals("1"));
                if (!handled) moveTaskToBack(true);
            });
        } catch (Exception e) {
            moveTaskToBack(true);
        }
    }

    private void flushCookies() {
        try {
            CookieManager.getInstance().flush();
        } catch (Exception ignored) {
        }
    }
}
