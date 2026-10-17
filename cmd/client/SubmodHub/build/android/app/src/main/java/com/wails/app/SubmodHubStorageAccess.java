package com.wails.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.util.Log;

import java.io.File;

/**
 * SubmodHubStorageAccess encapsulates MANAGE_EXTERNAL_STORAGE permission
 * checking and Settings navigation on Android 11+ (API 30+).
 */
public class SubmodHubStorageAccess {
    private static final String TAG = "SubmodHubStorage";
    private static volatile Activity currentActivity;

    public static void init(Activity activity) {
        currentActivity = activity;
    }

    public static void onResume(Activity activity) {
        currentActivity = activity;
        String state = getStorageAccessState();
        if (activity instanceof MainActivity) {
            MainActivity mainActivity = (MainActivity) activity;
            if (mainActivity.getBridge() != null) {
                mainActivity.getBridge().emitEvent("submodhub:storage_state_changed", "{\"state\":\"" + state + "\"}");
            }
        }
    }

    /**
     * Query real-time permission status.
     * Returns: "granted", "denied", "unsupported", or "error".
     */
    public static String getStorageAccessState() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            return "unsupported";
        }
        try {
            boolean granted = Environment.isExternalStorageManager();
            return granted ? "granted" : "denied";
        } catch (Throwable t) {
            Log.e(TAG, "Error checking external storage manager", t);
            return "error";
        }
    }

    /**
     * Launch app-specific All files access Settings page.
     * Falls back to general All files access page if app-specific intent fails.
     * Returns true if settings intent was launched, false otherwise.
     */
    public static boolean requestStorageAccess() {
        Activity activity = currentActivity;
        if (activity == null) {
            Log.e(TAG, "No activity available to request storage access");
            return false;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            Log.w(TAG, "Storage access request unsupported on Android < 11");
            return false;
        }

        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
            intent.setData(Uri.parse("package:" + activity.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(intent);
            return true;
        } catch (Throwable e) {
            Log.w(TAG, "Failed to open app-specific storage settings, falling back to all-files settings", e);
            try {
                Intent fallback = new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(fallback);
                return true;
            } catch (Throwable e2) {
                Log.e(TAG, "Failed to open any storage settings intent", e2);
                return false;
            }
        }
    }

    public static String getInternalFilesDir() {
        Activity activity = currentActivity;
        if (activity != null) {
            File f = activity.getFilesDir();
            if (f != null) {
                return f.getAbsolutePath();
            }
        }
        return "/data/data/com.reze.submodhub/files";
    }

    public static String getInternalCacheDir() {
        Activity activity = currentActivity;
        if (activity != null) {
            File c = activity.getCacheDir();
            if (c != null) {
                return c.getAbsolutePath();
            }
        }
        return "/data/data/com.reze.submodhub/cache";
    }
}
