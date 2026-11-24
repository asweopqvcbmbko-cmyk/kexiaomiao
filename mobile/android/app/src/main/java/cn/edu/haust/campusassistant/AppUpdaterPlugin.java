package cn.edu.haust.campusassistant;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 原生云端更新插件：
 * - getAppVersion(): 返回真实已安装版本的 versionCode / versionName
 * - fetchManifest(): 原生 HTTP 多路镜像回退拉取 update-manifest.json（免疫 WebView CORS）
 * - downloadAndVerify(): 流式下载 APK + 实时进度事件 + 强制 SHA256 校验 + 多路镜像回退
 * - installApk(): 检查未知来源安装权限并通过 FileProvider 调起系统安装器覆盖安装
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    private static final String UA = "KeXiaoMiao-Updater/1.0 (Android)";
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final AtomicBoolean downloadCancelled = new AtomicBoolean(false);

    @Override
    protected void handleOnDestroy() {
        downloadCancelled.set(true);
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    @PluginMethod
    public void getAppVersion(PluginCall call) {
        try {
            PackageManager pm = getContext().getPackageManager();
            PackageInfo info = pm.getPackageInfo(getContext().getPackageName(), 0);
            long code = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? info.getLongVersionCode()
                    : info.versionCode;
            JSObject ret = new JSObject();
            ret.put("versionCode", code);
            ret.put("versionName", info.versionName != null ? info.versionName : "0.0.0");
            ret.put("packageName", getContext().getPackageName());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("getAppVersion failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void fetchManifest(PluginCall call) {
        List<String> urls = extractHttpsUrls(call.getArray("urls"));
        if (urls.isEmpty()) {
            call.reject("urls required");
            return;
        }
        executor.execute(() -> {
            String lastError = "无法连接更新服务器";
            for (String urlStr : urls) {
                HttpURLConnection conn = null;
                try {
                    conn = openConnection(urlStr, 10000, 12000);
                    int status = conn.getResponseCode();
                    if (status < 200 || status >= 300) {
                        lastError = "HTTP " + status;
                        continue;
                    }
                    try (InputStream in = new BufferedInputStream(conn.getInputStream());
                         ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                        byte[] buf = new byte[8192];
                        int n;
                        int total = 0;
                        while ((n = in.read(buf)) != -1) {
                            total += n;
                            if (total > 512 * 1024) throw new IllegalStateException("manifest too large");
                            out.write(buf, 0, n);
                        }
                        String body = out.toString(StandardCharsets.UTF_8.name());
                        JSObject ret = new JSObject();
                        ret.put("body", body);
                        ret.put("url", urlStr);
                        call.resolve(ret);
                        return;
                    }
                } catch (Exception e) {
                    lastError = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
                } finally {
                    if (conn != null) conn.disconnect();
                }
            }
            call.reject("检查更新失败：" + lastError);
        });
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        downloadCancelled.set(true);
        JSObject ret = new JSObject();
        ret.put("cancelled", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void downloadAndVerify(PluginCall call) {
        List<String> urls = extractHttpsUrls(call.getArray("urls"));
        String expectedSha256 = call.getString("sha256", "").trim().toLowerCase(Locale.ROOT);
        String rawName = call.getString("filename", "kexiaomiao-update.apk");
        String safeName = rawName.replaceAll("[^A-Za-z0-9._-]", "_");
        if (!safeName.endsWith(".apk")) safeName += ".apk";
        if (urls.isEmpty()) {
            call.reject("urls required");
            return;
        }

        downloadCancelled.set(false);
        final String finalFileName = safeName;

        executor.execute(() -> {
            File dir = new File(getContext().getCacheDir(), "updates");
            if (!dir.exists() && !dir.mkdirs()) {
                call.reject("无法创建更新缓存目录");
                return;
            }
            // 清理旧的缓存 APK，释放存储空间
            File[] oldFiles = dir.listFiles();
            if (oldFiles != null) {
                for (File f : oldFiles) {
                    if (f.isFile() && f.getName().endsWith(".apk")) {
                        //noinspection ResultOfMethodCallIgnored
                        f.delete();
                    }
                }
            }

            File target = new File(dir, finalFileName);
            File part = new File(dir, finalFileName + ".part");
            String lastError = "所有下载源均失败";

            for (int i = 0; i < urls.size(); i++) {
                if (downloadCancelled.get()) {
                    cleanupFile(part);
                    call.reject("CANCELLED");
                    return;
                }
                String urlStr = urls.get(i);
                HttpURLConnection conn = null;
                try {
                    cleanupFile(part);
                    conn = openConnection(urlStr, 12000, 30000);
                    int status = conn.getResponseCode();
                    if (status < 200 || status >= 300) {
                        lastError = "HTTP " + status;
                        continue;
                    }
                    long totalBytes = conn.getContentLengthLong();
                    MessageDigest digest = MessageDigest.getInstance("SHA-256");
                    long downloaded = 0;
                    long startedAt = System.currentTimeMillis();
                    long lastEmit = 0;
                    boolean tooSlow = false;
                    boolean hasFallback = i < urls.size() - 1;

                    try (InputStream in = new BufferedInputStream(conn.getInputStream());
                         FileOutputStream fos = new FileOutputStream(part)) {
                        byte[] buf = new byte[16384];
                        int n;
                        while ((n = in.read(buf)) != -1) {
                            if (downloadCancelled.get()) {
                                cleanupFile(part);
                                call.reject("CANCELLED");
                                return;
                            }
                            fos.write(buf, 0, n);
                            digest.update(buf, 0, n);
                            downloaded += n;
                            long now = System.currentTimeMillis();
                            long elapsedMs = Math.max(1L, now - startedAt);
                            long speedBps = downloaded * 1000L / elapsedMs;
                            // 若还有备用节点，且 3 秒后平均速率仍低于 150 KB/s，主动熔断切换更快节点
                            if (hasFallback && elapsedMs >= 3000L && speedBps < 150L * 1024L && downloaded < totalBytes * 8L / 10L) {
                                tooSlow = true;
                                break;
                            }
                            if (now - lastEmit >= 160) {
                                lastEmit = now;
                                emitProgress(downloaded, totalBytes, i, speedBps);
                            }
                        }
                        if (!tooSlow) fos.getFD().sync();
                    }

                    if (tooSlow) {
                        cleanupFile(part);
                        lastError = "节点过慢，正在切换高速源";
                        continue;
                    }

                    long finalElapsed = Math.max(1L, System.currentTimeMillis() - startedAt);
                    emitProgress(downloaded, totalBytes > 0 ? totalBytes : downloaded, i, downloaded * 1000L / finalElapsed);
                    String actualSha = toHex(digest.digest());
                    if (!expectedSha256.isEmpty() && !expectedSha256.equals(actualSha)) {
                        cleanupFile(part);
                        lastError = "安装包校验失败（SHA256 不匹配）";
                        continue;
                    }
                    if (target.exists()) cleanupFile(target);
                    if (!part.renameTo(target)) {
                        cleanupFile(part);
                        lastError = "保存安装包失败";
                        continue;
                    }

                    JSObject ret = new JSObject();
                    ret.put("filePath", target.getAbsolutePath());
                    ret.put("sha256", actualSha);
                    ret.put("size", downloaded);
                    ret.put("url", urlStr);
                    call.resolve(ret);
                    return;
                } catch (Exception e) {
                    cleanupFile(part);
                    lastError = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
                } finally {
                    if (conn != null) conn.disconnect();
                }
            }
            call.reject("下载失败：" + lastError);
        });
    }

    @PluginMethod
    public void canRequestPackageInstalls(PluginCall call) {
        boolean allowed = Build.VERSION.SDK_INT < Build.VERSION_CODES.O
                || getContext().getPackageManager().canRequestPackageInstalls();
        JSObject ret = new JSObject();
        ret.put("allowed", allowed);
        call.resolve(ret);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(intent);
            }
            JSObject ret = new JSObject();
            ret.put("opened", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("无法打开安装权限设置：" + e.getMessage());
        }
    }

    @PluginMethod
    public void installApk(PluginCall call) {
        String filePath = call.getString("filePath", "");
        if (filePath.isEmpty()) {
            call.reject("filePath required");
            return;
        }
        try {
            File file = new File(filePath).getCanonicalFile();
            File updatesDir = new File(getContext().getCacheDir(), "updates").getCanonicalFile();
            if (!file.getPath().startsWith(updatesDir.getPath() + File.separator) || !file.exists()) {
                call.reject("安装包文件无效或已过期");
                return;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    && !getContext().getPackageManager().canRequestPackageInstalls()) {
                JSObject ret = new JSObject();
                ret.put("launched", false);
                ret.put("needsPermission", true);
                call.resolve(ret);
                return;
            }
            Uri contentUri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    file
            );
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(contentUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);

            JSObject ret = new JSObject();
            ret.put("launched", true);
            ret.put("needsPermission", false);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("调起系统安装器失败：" + e.getMessage());
        }
    }

    private void emitProgress(long downloaded, long total, int mirrorIndex, long speedBytesPerSec) {
        JSObject data = new JSObject();
        data.put("downloadedBytes", downloaded);
        data.put("totalBytes", total);
        int pct = total > 0 ? (int) Math.min(100, Math.round(downloaded * 100.0 / total)) : -1;
        data.put("percent", pct);
        data.put("mirrorIndex", mirrorIndex);
        data.put("speedBytesPerSec", speedBytesPerSec);
        notifyListeners("downloadProgress", data);
    }

    private HttpURLConnection openConnection(String urlStr, int connectMs, int readMs) throws Exception {
        String current = urlStr;
        for (int hops = 0; hops < 6; hops++) {
            URL url = new URL(current);
            if (!"https".equalsIgnoreCase(url.getProtocol())) {
                throw new IllegalArgumentException("仅允许 HTTPS 更新源");
            }
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(connectMs);
            conn.setReadTimeout(readMs);
            conn.setRequestProperty("User-Agent", UA);
            conn.setRequestProperty("Cache-Control", "no-cache");
            int code = conn.getResponseCode();
            if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                String loc = conn.getHeaderField("Location");
                conn.disconnect();
                if (loc == null || loc.isEmpty()) throw new IllegalStateException("Redirect without Location");
                current = new URL(url, loc).toString();
                continue;
            }
            return conn;
        }
        throw new IllegalStateException("Too many redirects");
    }

    private List<String> extractHttpsUrls(JSArray array) {
        List<String> out = new ArrayList<>();
        if (array == null) return out;
        try {
            for (int i = 0; i < array.length(); i++) {
                String u = array.optString(i, "").trim();
                if (u.startsWith("https://")) out.add(u);
            }
        } catch (Exception ignored) {
        }
        return out;
    }

    private void cleanupFile(File f) {
        try {
            if (f != null && f.exists()) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
        } catch (Exception ignored) {
        }
    }

    private String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(Character.forDigit((b >> 4) & 0xF, 16));
            sb.append(Character.forDigit(b & 0xF, 16));
        }
        return sb.toString();
    }
}
