package com.shunci.teleprompter;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.IOException;
import java.io.InputStream;
import java.io.ByteArrayInputStream;
import java.util.Locale;

@SuppressWarnings("deprecation")
public class MainActivity extends Activity {
    private static final String APP_ORIGIN = "appassets.androidplatform.net";
    private static final int FILE_CHOOSER_REQUEST = 6102;
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(11, 12, 13));
        getWindow().setNavigationBarColor(Color.rgb(8, 9, 10));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(11, 12, 13));
        setContentView(webView);
        configureWebView();

        if (savedInstanceState == null) {
            webView.loadUrl("https://" + APP_ORIGIN + "/assets/index.html");
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    @SuppressLint("SetJavaScriptEnabled") // Required by the bundled app; navigation is restricted to the local synthetic origin.
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);

        webView.addJavascriptInterface(new AndroidBridge(), "AndroidTeleprompter");
        webView.setWebViewClient(new AssetWebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("text/plain");
                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                    return true;
                } catch (ActivityNotFoundException error) {
                    fileCallback = null;
                    Toast.makeText(MainActivity.this, "没有可用的文件选择器", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });
    }

    public final class AndroidBridge {
        @JavascriptInterface
        public void setLandscape(boolean enabled) {
            runOnUiThread(() -> {
                setRequestedOrientation(enabled
                    ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                    : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
                if (enabled) enterImmersiveMode(); else leaveImmersiveMode();
            });
        }

        @JavascriptInterface
        public void keepScreenOn(boolean enabled) {
            runOnUiThread(() -> {
                if (enabled) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }
    }

    private void enterImmersiveMode() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }

    private void leaveImmersiveMode() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        webView.saveState(state);
        super.onSaveInstanceState(state);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_REQUEST || fileCallback == null) return;
        Uri[] result = resultCode == RESULT_OK && data != null && data.getData() != null
            ? new Uri[]{data.getData()} : null;
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    @Override
    public void onBackPressed() {
        webView.evaluateJavascript("document.querySelector('#promptScreen')?.hidden === false", value -> {
            if ("true".equals(value)) {
                webView.evaluateJavascript("document.querySelector('#backButton').click()", null);
            } else {
                MainActivity.super.onBackPressed();
            }
        });
    }

    private final class AssetWebViewClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!"https".equals(uri.getScheme()) || !APP_ORIGIN.equals(uri.getHost()) || !uri.getPath().startsWith("/assets/")) {
                return emptyResponse(403, "Forbidden");
            }
            String assetPath = uri.getPath().substring("/assets/".length());
            if (assetPath.isEmpty()) assetPath = "index.html";
            if (assetPath.contains("..")) {
                return emptyResponse(400, "Bad Request");
            }
            try {
                InputStream stream = getAssets().open(assetPath);
                return new WebResourceResponse(mimeType(assetPath), "UTF-8", stream);
            } catch (IOException error) {
                return emptyResponse(404, "Not Found");
            }
        }

        private WebResourceResponse emptyResponse(int status, String reason) {
            return new WebResourceResponse("text/plain", "UTF-8", status, reason, null, new ByteArrayInputStream(new byte[0]));
        }

        private String mimeType(String path) {
            String extension = MimeTypeMap.getFileExtensionFromUrl(path).toLowerCase(Locale.ROOT);
            if ("mjs".equals(extension) || "js".equals(extension)) return "text/javascript";
            if ("webmanifest".equals(extension)) return "application/manifest+json";
            if ("svg".equals(extension)) return "image/svg+xml";
            String detected = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
            return detected != null ? detected : "application/octet-stream";
        }
    }
}
