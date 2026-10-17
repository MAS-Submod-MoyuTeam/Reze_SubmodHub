//go:build android && !cgo

package main

const isAndroidPlatform = true

type androidStorageAccessProvider struct{}

func (a *androidStorageAccessProvider) GetStorageAccess() (AndroidStorageAccessStatus, error) {
	return defaultAndroidStorageStatus(), nil
}

func (a *androidStorageAccessProvider) RequestStorageAccess() (AndroidStorageAccessRequestResult, error) {
	return AndroidStorageAccessRequestResult{
		Opened: false,
		Error:  "cgo_disabled",
	}, nil
}

func newPlatformStorageAccessProvider() StorageAccessProvider {
	return &androidStorageAccessProvider{}
}

func getPlatformInternalConfigDir() (string, error) {
	return "/data/data/com.reze.submodhub/files", nil
}

func getPlatformInternalCacheDir() (string, error) {
	return "/data/data/com.reze.submodhub/cache", nil
}
