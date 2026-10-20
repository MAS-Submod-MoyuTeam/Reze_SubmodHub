package cloudreve

import (
	"context"
	"errors"
	"strings"
)

// EnsureDirectory returns verified directory metadata. Only Cloudreve's explicit
// directory-not-found business response permits creating the configured path;
// HTTP routing errors, authentication, permissions and transport failures do not.
func (c *Client) EnsureDirectory(ctx context.Context, directory string) (Listing, error) {
	if !strings.HasPrefix(directory, "/") {
		return Listing{}, errors.New("cloudreve_directory_invalid")
	}
	listing, err := c.List(ctx, directory)
	if err == nil || directory == "/" || !errors.Is(err, apiError(404)) {
		return listing, err
	}
	createErr := c.CreateDirectory(ctx, directory)
	// A concurrent tester/worker may have created it first. Read back even when
	// creation fails; a failed creation alone never constitutes success.
	listing, verifyErr := c.List(ctx, directory)
	if verifyErr == nil {
		return listing, nil
	}
	if createErr != nil {
		return Listing{}, createErr
	}
	return Listing{}, verifyErr
}
