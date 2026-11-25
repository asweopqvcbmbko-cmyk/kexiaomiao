package cn.edu.haust.campusassistant;

import android.os.Bundle;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 数据层要用的「隐藏浏览器」插件，必须在 super.onCreate 之前注册
        registerPlugin(SchoolBrowserPlugin.class);
        registerPlugin(SchoolCredentialsPlugin.class);
        registerPlugin(AppUpdaterPlugin.class);
        super.onCreate(savedInstanceState);

        // 禁用 Android 12+ 系统级 WebView 边缘果冻拉伸（EdgeEffect Stretch），避免与自定义下拉刷新叠加导致页面与底栏变形
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().setOverScrollMode(View.OVER_SCROLL_NEVER);
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
