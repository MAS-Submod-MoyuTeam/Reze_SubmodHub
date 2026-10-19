package com.wails.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import androidx.core.content.FileProvider;

import java.io.File;

/**
 * SubmodHubAppUpdate encapsulates Android APK installation triggering,
 * checking REQUEST_INSTALL_PACKAGES permission, and directing users to system install screens.
 */
public class SubmodHubAppUpdate {
    private static final String TAG = "SubmodHubAppUpdate";
    private static volatile Activity currentActivity;
    private static final int INSTALL_REQUEST = 7020;
    private static volatile String lastInstallResult = "none";
    private static volatile boolean installerLeftForeground;

    public static void onPause() {
        if ("launched".equals(lastInstallResult)) installerLeftForeground = true;
    }

    public static void onResume() {
        // Some system installers do not return an activity result. Returning to
        // the old running app is not proof of success; allow a safe retry.
        if (installerLeftForeground && "launched".equals(lastInstallResult)) {
            lastInstallResult = "returned";
        }
        installerLeftForeground = false;
    }

    public static boolean onActivityResult(int requestCode, int resultCode) {
        if (requestCode != INSTALL_REQUEST) return false;
        if (resultCode == Activity.RESULT_OK) {
            lastInstallResult = "completed";
        } else if (resultCode == Activity.RESULT_CANCELED) {
            lastInstallResult = "cancelled";
        } else {
            lastInstallResult = "failed";
        }
        installerLeftForeground = false;
        return true;
    }

    public static void init(Activity activity) {
        currentActivity = activity;
    }

    /**
     * Checks if installing unknown apps is permitted on Android 8+ (Oreo, API 26+).
     * Returns true if permitted or unsupported (pre-Oreo), false if user must grant permission.
     */
    public static boolean canRequestPackageInstalls() {
        Activity activity = currentActivity;
        if (activity == null) return false;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                return activity.getPackageManager().canRequestPackageInstalls();
            } catch (Throwable t) {
                Log.e(TAG, "Failed to check canRequestPackageInstalls", t);
                return false;
            }
        }
        return true;
    }

    /**
     * Launches the system settings screen to allow installing unknown apps from this application.
     */
    public static boolean openAppUpdateSettings() {
        Activity activity = currentActivity;
        if (activity == null) return false;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                intent.setData(Uri.parse("package:" + activity.getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(intent);
                return true;
            } catch (Throwable t) {
                Log.e(TAG, "Failed to open ACTION_MANAGE_UNKNOWN_APP_SOURCES", t);
            }
        }
        return false;
    }

    /**
     * Launches the system package installer for the given downloaded APK file path.
     */
    public static boolean installDownloadedApk(String apkFilePath) {
        Activity activity = currentActivity;
        if (activity == null) {
            Log.e(TAG, "No activity available to trigger APK install");
            lastInstallResult = "no_activity";
            return false;
        }

        File apkFile = new File(apkFilePath);
        if (!apkFile.exists() || !apkFile.isFile() || apkFile.length() == 0) {
            Log.e(TAG, "APK file does not exist or is empty: " + apkFilePath);
            lastInstallResult = "file_not_found";
            return false;
        }

        try {
            Uri contentUri = FileProvider.getUriForFile(
                    activity,
                    activity.getPackageName() + ".fileprovider",
                    apkFile
            );

            Intent intent = new Intent(Intent.ACTION_INSTALL_PACKAGE);
            intent.setDataAndType(contentUri, "application/vnd.android.package-archive");
            intent.setClipData(ClipData.newRawUri("SubmodHub update", contentUri));
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.putExtra(Intent.EXTRA_RETURN_RESULT, true);

            installerLeftForeground = false;
            lastInstallResult = "launched";
            activity.runOnUiThread(() -> {
                try {
                    activity.startActivityForResult(intent, INSTALL_REQUEST);
                } catch (Throwable t) {
                    Log.e(TAG, "Error starting APK install intent", t);
                    lastInstallResult = "intent_failed: " + t.getMessage();
                }
            });
            return true;
        } catch (Throwable t) {
            Log.e(TAG, "Error starting APK install intent", t);
            lastInstallResult = "intent_failed: " + t.getMessage();
            return false;
        }
    }

    public static String getLastInstallResult() {
        return lastInstallResult;
    }
}
