//go:build android && cgo

package main

/*
#include <jni.h>
#include <stdlib.h>
#include <string.h>

static JavaVM* g_submod_jvm = NULL;
static jclass g_submod_storage_cls = NULL;

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
    }
    return JNI_VERSION_1_6;
}

JNIEXPORT void JNICALL JNI_OnUnload(JavaVM* vm, void* reserved) {
    if (g_submod_jvm != NULL && g_submod_storage_cls != NULL) {
        JNIEnv* env = NULL;
        if ((*g_submod_jvm)->GetEnv(g_submod_jvm, (void**)&env, JNI_VERSION_1_6) == JNI_OK && env != NULL) {
            (*env)->DeleteGlobalRef(env, g_submod_storage_cls);
        }
        g_submod_storage_cls = NULL;
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

static char* jstringToNative(JNIEnv* env, jstring jstr) {
    if (env == NULL || jstr == NULL) return NULL;
    const char* chars = (*env)->GetStringUTFChars(env, jstr, NULL);
    if (chars == NULL) return NULL;
    char* copy = strdup(chars);
    (*env)->ReleaseStringUTFChars(env, jstr, chars);
    return copy;
}

static jbyteArray createByteArray(JNIEnv* env, const void* data, int len) {
    if (env == NULL || data == NULL || len <= 0) return NULL;
    jbyteArray arr = (*env)->NewByteArray(env, (jsize)len);
    if (arr == NULL) return NULL;
    (*env)->SetByteArrayRegion(env, arr, 0, (jsize)len, (const jbyte*)data);
    return arr;
}
*/
import "C"

import (
	"encoding/binary"
	"unsafe"

	"github.com/reze/submodhub/internal/maspath"
)

//export Java_com_wails_app_WailsBridge_nativeServeApiRequest
func Java_com_wails_app_WailsBridge_nativeServeApiRequest(env *C.JNIEnv, obj C.jobject, jurl C.jstring, jmethod C.jstring, jheaders C.jstring) C.jbyteArray {
	cURL := C.jstringToNative(env, jurl)
	if cURL == nil {
		return nil
	}
	defer C.free(unsafe.Pointer(cURL))
	goURL := C.GoString(cURL)

	goMethod := "GET"
	if jmethod != nil {
		cMethod := C.jstringToNative(env, jmethod)
		if cMethod != nil {
			goMethod = C.GoString(cMethod)
			C.free(unsafe.Pointer(cMethod))
		}
	}

	statusCode, contentType, body, _ := serveAssetDetailed(goMethod, goURL, nil, nil)

	mimeBytes := []byte(contentType)
	if len(mimeBytes) > 65535 {
		mimeBytes = mimeBytes[:65535]
	}
	buf := make([]byte, 4+2+len(mimeBytes)+len(body))
	binary.BigEndian.PutUint32(buf[0:4], uint32(statusCode))
	binary.BigEndian.PutUint16(buf[4:6], uint16(len(mimeBytes)))
	copy(buf[6:6+len(mimeBytes)], mimeBytes)
	copy(buf[6+len(mimeBytes):], body)

	return C.createByteArray(env, unsafe.Pointer(&buf[0]), C.int(len(buf)))
}

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
