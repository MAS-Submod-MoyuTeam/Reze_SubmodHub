package maspath

import "strings"

// AndroidMASRoot is the expected MAS installation root, not an access grant.
const AndroidMASRoot = "/storage/emulated/0/MAS/"

func AndroidGameDirectory() string {
	return strings.TrimRight(AndroidMASRoot, "/") + "/game"
}
