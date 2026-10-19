//go:build android && cgo

package main

/*
#include <jni.h>
#include <stdlib.h>
#include <string.h>

static JavaVM* g_submod_jvm = NULL;
static jclass g_submod_storage_cls = NULL;
static jclass g_submod_update_cls = NULL;

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void* reserved) {
    g_submod_jvm = vm;
    JNIEnv* env = NULL;
    if ((*vm)->GetEnv(vm, (void**)&env, JNI_VERSION_1_6) == JNI_OK && env != NULL) {
        jclass cls = (*env)->FindClass(env, "com/wails/app/SubmodHubStorageAccess");
        if (cls != NULL) {
            g_submod_storage_cls = (jclass)(*env)->NewGlobalRef(env, cls);
            (*env)->DeleteLocalRef(env, cls);
        } else {
            (*env)->ExceptionClear(env);
        }

        jclass ucls = (*env)->FindClass(env, "com/wails/app/SubmodHubAppUpdate");
        if (ucls != NULL) {
            g_submod_update_cls = (jclass)(*env)->NewGlobalRef(env, ucls);
            (*env)->DeleteLocalRef(env, ucls);
        } else {
            (*env)->ExceptionClear(env);
        }
    }
    return JNI_VERSION_1_6;
}

JNIEXPORT void JNICALL JNI_OnUnload(JavaVM* vm, void* reserved) {
    if (g_submod_jvm != NULL) {
        JNIEnv* env = NULL;
        if ((*g_submod_jvm)->GetEnv(g_submod_jvm, (void**)&env, JNI_VERSION_1_6) == JNI_OK && env != NULL) {
            if (g_submod_storage_cls != NULL) {
                (*env)->DeleteGlobalRef(env, g_submod_storage_cls);
            }
            if (g_submod_update_cls != NULL) {
                (*env)->DeleteGlobalRef(env, g_submod_update_cls);
            }
        }
        g_submod_storage_cls = NULL;
        g_submod_update_cls = NULL;
    }
}

static JNIEnv* getSubmodJNIEnv(int* attached) {
    *attached = 0;
    if (g_submod_jvm == NULL) return NULL;
    JNIEnv* env = NULL;
    jint r = (*g_submod_jvm)->GetEnv(g_submod_jvm, (void**)&env, JNI_VERSION_1_6);
    if (r == JNI_EDETACHED) {
        if ((*g_submod_jvm)->AttachCurrentThread(g_submod_jvm, &env, NULL) != 0) {
            return NULL;
        }
        *attached = 1;
    } else if (r != JNI_OK) {
        return NULL;
    }
    return env;
}

static void releaseSubmodJNIEnv(int attached) {
    if (attached && g_submod_jvm != NULL) {
        (*g_submod_jvm)->DetachCurrentThread(g_submod_jvm);
    }
}

static jclass getSubmodStorageClass(JNIEnv* env) {
    if (g_submod_storage_cls != NULL) {
        return g_submod_storage_cls;
    }
    jclass cls = (*env)->FindClass(env, "com/wails/app/SubmodHubStorageAccess");
    if (cls != NULL) {
        g_submod_storage_cls = (jclass)(*env)->NewGlobalRef(env, cls);
        (*env)->DeleteLocalRef(env, cls);
        return g_submod_storage_cls;
    }
    (*env)->ExceptionClear(env);
    return NULL;
}

static char* jniGetStorageState() {
    int attached = 0;
    JNIEnv* env = getSubmodJNIEnv(&attached);
    if (env == NULL) return strdup("error");
    jclass cls = getSubmodStorageClass(env);
    if (cls == NULL) {
        releaseSubmodJNIEnv(attached);
        return strdup("error");
    }
    jmethodID mid = (*env)->GetStaticMethodID(env, cls, "getStorageAccessState", "()Ljava/lang/String;");
    if (mid == NULL) {
        (*env)->ExceptionClear(env);
        releaseSubmodJNIEnv(attached);
        return strdup("error");
    }
    jstring jstr = (jstring)(*env)->CallStaticObjectMethod(env, cls, mid);
    if ((*env)->ExceptionCheck(env)) {
        (*env)->ExceptionClear(env);
    }
    char* result = NULL;
    if (jstr != NULL) {
        const char* chars = (*env)->GetStringUTFChars(env, jstr, NULL);
        if (chars != NULL) {
            result = strdup(chars);
            (*env)->ReleaseStringUTFChars(env, jstr, chars);
        }
        (*env)->DeleteLocalRef(env, jstr);
    }
    releaseSubmodJNIEnv(attached);
    return result != NULL ? result : strdup("error");
}

static int jniRequestStorageAccess() {
    int attached = 0;
    JNIEnv* env = getSubmodJNIEnv(&attached);
    if (env == NULL) return 0;
    jclass cls = getSubmodStorageClass(env);
    if (cls == NULL) {
        releaseSubmodJNIEnv(attached);
        return 0;
    }
    jmethodID mid = (*env)->GetStaticMethodID(env, cls, "requestStorageAccess", "()Z");
    if (mid == NULL) {
        (*env)->ExceptionClear(env);
        releaseSubmodJNIEnv(attached);
        return 0;
    }
    jboolean res = (*env)->CallStaticBooleanMethod(env, cls, mid);
    if ((*env)->ExceptionCheck(env)) {
        (*env)->ExceptionClear(env);
    }
    releaseSubmodJNIEnv(attached);
    return res ? 1 : 0;
}

static char* jniGetFilesDir() {
    int attached = 0;
    JNIEnv* env = getSubmodJNIEnv(&attached);
    if (env == NULL) return strdup("/data/data/com.reze.submodhub/files");
    jclass cls = getSubmodStorageClass(env);
    if (cls == NULL) {
        releaseSubmodJNIEnv(attached);
        return strdup("/data/data/com.reze.submodhub/files");
    }
    jmethodID mid = (*env)->GetStaticMethodID(env, cls, "getInternalFilesDir", "()Ljava/lang/String;");
    if (mid == NULL) {
        (*env)->ExceptionClear(env);
        releaseSubmodJNIEnv(attached);
        return strdup("/data/data/com.reze.submodhub/files");
    }
    jstring jstr = (jstring)(*env)->CallStaticObjectMethod(env, cls, mid);
    if ((*env)->ExceptionCheck(env)) {
        (*env)->ExceptionClear(env);
    }
    char* result = NULL;
    if (jstr != NULL) {
        const char* chars = (*env)->GetStringUTFChars(env, jstr, NULL);
        if (chars != NULL) {
            result = strdup(chars);
            (*env)->ReleaseStringUTFChars(env, jstr, chars);
        }
        (*env)->DeleteLocalRef(env, jstr);
    }
    releaseSubmodJNIEnv(attached);
    return result != NULL ? result : strdup("/data/data/com.reze.submodhub/files");
}

static char* jniGetCacheDir() {
    int attached = 0;
    JNIEnv* env = getSubmodJNIEnv(&attached);
    if (env == NULL) return strdup("/data/data/com.reze.submodhub/cache");
    jclass cls = getSubmodStorageClass(env);
    if (cls == NULL) {
        releaseSubmodJNIEnv(attached);
        return strdup("/data/data/com.reze.submodhub/cache");
    }
    jmethodID mid = (*env)->GetStaticMethodID(env, cls, "getInternalCacheDir", "()Ljava/lang/String;");
    if (mid == NULL) {
        (*env)->ExceptionClear(env);
        releaseSubmodJNIEnv(attached);
        return strdup("/data/data/com.reze.submodhub/cache");
    }
    jstring jstr = (jstring)(*env)->CallStaticObjectMethod(env, cls, mid);
    if ((*env)->ExceptionCheck(env)) {
        (*env)->ExceptionClear(env);
    }
    char* result = NULL;
    if (jstr != NULL) {
        const char* chars = (*env)->GetStringUTFChars(env, jstr, NULL);
        if (chars != NULL) {
            result = strdup(chars);
            (*env)->ReleaseStringUTFChars(env, jstr, chars);
        }
        (*env)->DeleteLocalRef(env, jstr);
    }
    releaseSubmodJNIEnv(attached);
    return result != NULL ? result : strdup("/data/data/com.reze.submodhub/cache");
}

static jclass getSubmodUpdateClass(JNIEnv* env) {
    if (g_submod_update_cls != NULL) {
        return g_submod_update_cls;
    }
    jclass cls = (*env)->FindClass(env, "com/wails/app/SubmodHubAppUpdate");
    if (cls != NULL) {
        g_submod_update_cls = (jclass)(*env)->NewGlobalRef(env, cls);
        (*env)->DeleteLocalRef(env, cls);
        return g_submod_update_cls;
    }
    (*env)->ExceptionClear(env);
    return NULL;
}

static int jniCanRequestPackageInstalls() {
    int attached = 0;
    JNIEnv* env = getSubmodJNIEnv(&attached);
    if (env == NULL) return 0;
    jclass cls = getSubmodUpdateClass(env);
    if (cls == NULL) {
        releaseSubmodJNIEnv(attached);
        return 0;
    }
    jmethodID mid = (*env)->GetStaticMethodID(env, cls, "canRequestPackageInstalls", "()Z");
    if (mid == NULL) {
        (*env)->ExceptionClear(env);
        releaseSubmodJNIEnv(attached);
        return 0;
    }
    jboolean res = (*env)->CallStaticBooleanMethod(env, cls, mid);
    if ((*env)->ExceptionCheck(env)) {
        (*env)->ExceptionClear(env);
    }
    releaseSubmodJNIEnv(attached);
    return res ? 1 : 0;
}

static int jniOpenAppUpdateSettings() {
    int attached = 0;
    JNIEnv* env = getSubmodJNIEnv(&attached);
    if (env == NULL) return 0;
    jclass cls = getSubmodUpdateClass(env);
    if (cls == NULL) {
        releaseSubmodJNIEnv(attached);
        return 0;
    }
    jmethodID mid = (*env)->GetStaticMethodID(env, cls, "openAppUpdateSettings", "()Z");
    if (mid == NULL) {
        (*env)->ExceptionClear(env);
        releaseSubmodJNIEnv(attached);
        return 0;
    }
    jboolean res = (*env)->CallStaticBooleanMethod(env, cls, mid);
    if ((*env)->ExceptionCheck(env)) {
        (*env)->ExceptionClear(env);
    }
    releaseSubmodJNIEnv(attached);
    return res ? 1 : 0;
}

static int jniInstallDownloadedApk(const char* apkPath) {
    int attached = 0;
    JNIEnv* env = getSubmodJNIEnv(&attached);
    if (env == NULL) return 0;
    jclass cls = getSubmodUpdateClass(env);
    if (cls == NULL) {
        releaseSubmodJNIEnv(attached);
        return 0;
    }
    jmethodID mid = (*env)->GetStaticMethodID(env, cls, "installDownloadedApk", "(Ljava/lang/String;)Z");
    if (mid == NULL) {
        (*env)->ExceptionClear(env);
        releaseSubmodJNIEnv(attached);
        return 0;
    }
    jstring jPath = (*env)->NewStringUTF(env, apkPath);
    jboolean res = (*env)->CallStaticBooleanMethod(env, cls, mid, jPath);
    if ((*env)->ExceptionCheck(env)) {
        (*env)->ExceptionClear(env);
    }
    (*env)->DeleteLocalRef(env, jPath);
    releaseSubmodJNIEnv(attached);
    return res ? 1 : 0;
}

static char* jniGetLastInstallResult() {
    int attached = 0;
    JNIEnv* env = getSubmodJNIEnv(&attached);
    if (env == NULL) return strdup("no_env");
    jclass cls = getSubmodUpdateClass(env);
    if (cls == NULL) {
        releaseSubmodJNIEnv(attached);
        return strdup("no_class");
    }
    jmethodID mid = (*env)->GetStaticMethodID(env, cls, "getLastInstallResult", "()Ljava/lang/String;");
    if (mid == NULL) {
        (*env)->ExceptionClear(env);
        releaseSubmodJNIEnv(attached);
        return strdup("no_method");
    }
    jstring jstr = (jstring)(*env)->CallStaticObjectMethod(env, cls, mid);
    if ((*env)->ExceptionCheck(env)) {
        (*env)->ExceptionClear(env);
    }
    char* result = NULL;
    if (jstr != NULL) {
        const char* chars = (*env)->GetStringUTFChars(env, jstr, NULL);
        if (chars != NULL) {
            result = strdup(chars);
            (*env)->ReleaseStringUTFChars(env, jstr, chars);
        }
        (*env)->DeleteLocalRef(env, jstr);
    }
    releaseSubmodJNIEnv(attached);
    return result != NULL ? result : strdup("unknown");
}

*/
import "C"

import (
	"context"
	"fmt"
	"unsafe"

	"github.com/reze/submodhub/internal/maspath"
)

const isAndroidPlatform = true

type androidStorageAccessProvider struct{}

func (a *androidStorageAccessProvider) GetStorageAccess() (AndroidStorageAccessStatus, error) {
	cStr := C.jniGetStorageState()
	defer C.free(unsafe.Pointer(cStr))
	state := C.GoString(cStr)

	return AndroidStorageAccessStatus{
		State:    state,
		Root:     maspath.AndroidMASRoot,
		GamePath: maspath.AndroidGameDirectory(),
	}, nil
}

func (a *androidStorageAccessProvider) RequestStorageAccess() (AndroidStorageAccessRequestResult, error) {
	res := C.jniRequestStorageAccess()
	return AndroidStorageAccessRequestResult{
		Opened: res != 0,
	}, nil
}

func newPlatformStorageAccessProvider() StorageAccessProvider {
	return &androidStorageAccessProvider{}
}

func getPlatformInternalConfigDir() (string, error) {
	cStr := C.jniGetFilesDir()
	defer C.free(unsafe.Pointer(cStr))
	return C.GoString(cStr), nil
}

func getPlatformInternalCacheDir() (string, error) {
	cStr := C.jniGetCacheDir()
	defer C.free(unsafe.Pointer(cStr))
	return C.GoString(cStr), nil
}

type androidCgoUpdateBridge struct{}

func (a *androidCgoUpdateBridge) CanInstallDirectly() bool {
	return false
}

func (a *androidCgoUpdateBridge) CanRequestPackageInstalls() (bool, error) {
	res := C.jniCanRequestPackageInstalls()
	return res != 0, nil
}

func (a *androidCgoUpdateBridge) OpenAppUpdateSettings() (bool, error) {
	res := C.jniOpenAppUpdateSettings()
	return res != 0, nil
}

func (a *androidCgoUpdateBridge) InstallDownloadedApk(apkPath string) (bool, error) {
	cPath := C.CString(apkPath)
	defer C.free(unsafe.Pointer(cPath))
	res := C.jniInstallDownloadedApk(cPath)
	return res != 0, nil
}

func (a *androidCgoUpdateBridge) GetLastInstallResult() (string, error) {
	cStr := C.jniGetLastInstallResult()
	defer C.free(unsafe.Pointer(cStr))
	return C.GoString(cStr), nil
}

func (a *androidCgoUpdateBridge) Install(ctx context.Context, targetFilePath string, currentAppPath string) error {
	ok, err := a.InstallDownloadedApk(targetFilePath)
	if err != nil {
		return err
	}
	if !ok {
		result, _ := a.GetLastInstallResult()
		return fmt.Errorf("failed to launch package installer: %s", result)
	}
	return nil
}

func newPlatformUpdateBridge() PlatformUpdateBridge {
	return &androidCgoUpdateBridge{}
}
