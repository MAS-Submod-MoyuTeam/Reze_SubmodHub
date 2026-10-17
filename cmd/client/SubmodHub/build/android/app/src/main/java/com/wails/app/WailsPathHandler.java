package com.wails.app;

import android.net.Uri;
import android.util.Log;
import android.webkit.WebResourceResponse;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.webkit.WebViewAssetLoader;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * WailsPathHandler implements WebViewAssetLoader.PathHandler to serve assets
 * from the Go asset server. This allows the WebView to load assets without
 * using a network server, similar to iOS's WKURLSchemeHandler.
 */
public class WailsPathHandler implements WebViewAssetLoader.PathHandler {
    private static final String TAG = "WailsPathHandler";
    private static final boolean DEBUG = BuildConfig.DEBUG;

    private final WailsBridge bridge;

    public WailsPathHandler(WailsBridge bridge) {
        this.bridge = bridge;
    }

    @Nullable
    @Override
    public WebResourceResponse handle(@NonNull String path) {
        if (DEBUG) Log.d(TAG, "Handling path: " + path);

        // Normalize path
        if (path.isEmpty() || path.equals("/")) {
            path = "/index.html";
        }

        // Get asset from Go
        byte[] data = bridge.serveAsset(path, "GET", "{}");

        if (data == null || data.length == 0) {
            Log.w(TAG, "Asset not found: " + path);
            return null; // Return null to let WebView handle 404
        }

        // Determine MIME type
        String mimeType = bridge.getAssetMimeType(path);
        if (mimeType == null || "application/octet-stream".equals(mimeType)) {
            mimeType = detectMimeType(data, path);
        }
        if (DEBUG) Log.d(TAG, "Serving " + path + " with type " + mimeType + " (" + data.length + " bytes)");

        // Create response
        InputStream inputStream = new ByteArrayInputStream(data);
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Cache-Control", "no-cache");

        return new WebResourceResponse(
                mimeType,
                "UTF-8",
                200,
                "OK",
                headers,
                inputStream
        );
    }

    public static String detectMimeType(byte[] data, String path) {
        if (data != null && data.length >= 4) {
            // PNG: 89 50 4E 47
            if ((data[0] & 0xFF) == 0x89 && data[1] == 'P' && data[2] == 'N' && data[3] == 'G') {
                return "image/png";
            }
            // JPEG: FF D8 FF
            if ((data[0] & 0xFF) == 0xFF && (data[1] & 0xFF) == 0xD8 && (data[2] & 0xFF) == 0xFF) {
                return "image/jpeg";
            }
            // GIF: GIF8
            if (data[0] == 'G' && data[1] == 'I' && data[2] == 'F' && data[3] == '8') {
                return "image/gif";
            }
            // WEBP: RIFF....WEBP
            if (data.length >= 12 && data[0] == 'R' && data[1] == 'I' && data[2] == 'F' && data[3] == 'F'
                    && data[8] == 'W' && data[9] == 'E' && data[10] == 'B' && data[11] == 'P') {
                return "image/webp";
            }
            // JSON: starts with whitespace, '{', or '['
            for (byte b : data) {
                if (b == ' ' || b == '\t' || b == '\r' || b == '\n') continue;
                if (b == '{' || b == '[') {
                    return "application/json";
                }
                break;
            }
            // SVG: <svg or <?xml
            String prefix = new String(data, 0, Math.min(data.length, 128)).trim();
            if (prefix.startsWith("<svg") || prefix.startsWith("<?xml")) {
                return "image/svg+xml";
            }
        }
        return "application/octet-stream";
    }
}
