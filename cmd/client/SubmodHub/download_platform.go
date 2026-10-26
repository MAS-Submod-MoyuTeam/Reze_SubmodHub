package main

// downloadPlatform is the platform name this build asks the server for when a
// version ships one archive per platform. It is the build target, not user
// input: an Android build can never install a Windows archive, and the server
// rejects a per-platform request that names no platform at all.
//
// Empty means "this build has no per-platform archive of its own", which only
// happens for a desktop OS the catalog does not split. Such a build sends no
// platform and can still install single-file versions; a per-platform version
// then fails with platform_required instead of installing another platform's
// package.
func downloadPlatform() string {
	switch {
	case isAndroidPlatform:
		return "android"
	case isWindowsBuild:
		return "windows"
	default:
		return ""
	}
}
