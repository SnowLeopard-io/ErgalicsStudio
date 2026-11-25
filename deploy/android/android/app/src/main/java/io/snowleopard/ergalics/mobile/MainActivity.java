package io.snowleopard.ergalics.mobile;

import android.app.DownloadManager;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import com.getcapacitor.BridgeActivity;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Capacitor host for the plain Web renderer.
 *
 * The renderer deliberately does not see the Electron desktop bridge on mobile:
 * Pyodide/WASM and project storage stay in the WebView. The only native glue is
 * export handling — the web app downloads via a blob-URL anchor, which Android's
 * WebView reports to DownloadListener but DownloadManager cannot fetch. We read
 * those blobs back through the page and save them into the public Downloads dir.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView webView = getBridge().getWebView();
        webView.addJavascriptInterface(new ExportBridge(), "ErgalicsNative");
        webView.setDownloadListener(this::onDownloadStart);
    }

    private void onDownloadStart(String url, String userAgent, String contentDisposition,
                                 String mimeType, long contentLength) {
        String name = fileNameFrom(contentDisposition, mimeType);
        if (url.startsWith("blob:") || url.startsWith("data:")) {
            // Blob URLs are document-scoped: only the page can resolve them.
            String js = "(function(){"
                    + "fetch(" + quote(url) + ").then(function(r){return r.blob();})"
                    + ".then(function(b){var fr=new FileReader();"
                    + "fr.onload=function(){ErgalicsNative.saveBase64("
                    + quote(name) + ",String(fr.result).split(',')[1]);};"
                    + "fr.readAsDataURL(b);})"
                    + ".catch(function(e){console.error('Ergalics export failed',e);});})()";
            getBridge().getWebView().evaluateJavascript(js, null);
            return;
        }
        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
        request.setMimeType(mimeType);
        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
        ((DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(request);
    }

    private String fileNameFrom(String contentDisposition, String mimeType) {
        String fallback = "ergalics-export-" +
                new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(new Date());
        if (contentDisposition != null) {
            int i = contentDisposition.toLowerCase(Locale.US).indexOf("filename=");
            if (i >= 0) {
                String name = contentDisposition.substring(i + "filename=".length()).trim();
                name = name.replaceFirst("^\"|\"$", "");
                if (!name.isEmpty()) return sanitize(name);
            }
        }
        if (mimeType != null) {
            if (mimeType.contains("csv")) return fallback + ".csv";
            if (mimeType.contains("json")) return fallback + ".json";
            if (mimeType.contains("svg")) return fallback + ".svg";
            if (mimeType.contains("pdf")) return fallback + ".pdf";
            if (mimeType.contains("png")) return fallback + ".png";
            if (mimeType.contains("zip")) return fallback + ".zip";
        }
        return fallback + ".txt";
    }

    private static String sanitize(String name) {
        return name.replaceAll("[\\\\/:*?\"<>|]", "_");
    }

    private static String quote(String s) {
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", "\\n").replace("\r", "\\r") + "\"";
    }

    /** Called from the page after a blob URL has been resolved to base64. */
    public class ExportBridge {
        @JavascriptInterface
        public void saveBase64(String name, String base64) {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            runOnUiThread(() -> saveToDownloads(name, bytes));
        }
    }

    private void saveToDownloads(String name, byte[] bytes) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, name);
                values.put(MediaStore.Downloads.MIME_TYPE, "application/octet-stream");
                values.put(MediaStore.Downloads.IS_PENDING, 1);
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new IllegalStateException("MediaStore insert failed");
                try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                    out.write(bytes);
                }
                values.clear();
                values.put(MediaStore.Downloads.IS_PENDING, 0);
                getContentResolver().update(uri, values, null, null);
            } else {
                File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("Downloads dir unavailable");
                try (OutputStream out = new FileOutputStream(new File(dir, name))) {
                    out.write(bytes);
                }
            }
            Toast.makeText(this, "Saved to Downloads: " + name, Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            Toast.makeText(this, "Export failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }
}
