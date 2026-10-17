//go:build android && cgo

package main

/*
#include <jni.h>
#include <stdlib.h>
#include <string.h>

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
)

//export Java_com_wails_app_WailsBridge_nativeServeApiRequest
func Java_com_wails_app_WailsBridge_nativeServeApiRequest(env *C.JNIEnv, obj C.jobject, jurl C.jstring, jmethod C.jstring, jheaders C.jstring) C.jbyteArray {
	cURL := C.jstringToNative(env, jurl)
	if cURL == nil {
		return C.jbyteArray(0)
	}
	defer C.free(unsafe.Pointer(cURL))
	goURL := C.GoString(cURL)

	goMethod := "GET"
	if jmethod != C.jstring(0) {
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
