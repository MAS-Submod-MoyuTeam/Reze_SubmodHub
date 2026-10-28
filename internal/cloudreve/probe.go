package cloudreve

import (
	"context"
	"errors"
)

// DeleteCreatedObject is only for explicit temporary probes. Configuration
// deletion and mirror reconciliation must never invoke it.
func (c *Client) DeleteCreatedObject(ctx context.Context, directory string, created Object) error {
	if created.ID == "" || created.Name == "" || created.Type != "file" {
		return errors.New("cloudreve_cleanup_identity_invalid")
	}
	listing, err := c.ListAll(ctx, directory)
	if err != nil {
		return err
	}
	found := false
	for _, object := range listing.Objects {
		if object.Name == created.Name {
			if object.ID != created.ID || object.Size != created.Size || object.Type != "file" {
				return errors.New("cloudreve_cleanup_identity_changed")
			}
			found = true
			break
		}
	}
	if !found {
		return nil
	}
	if err = c.RemoveObjects(ctx, directory, []string{created.ID}); err != nil {
		return err
	}
	// RemoveObjects already confirmed the ID; a probe also owns the name it
	// created, so the name must be gone too. This is a third complete listing and
	// is intentional: names are not an identity, so only the name check can prove
	// the replacement did not happen.
	listing, err = c.ListAll(ctx, directory)
	if err != nil {
		return err
	}
	for _, object := range listing.Objects {
		if object.ID == created.ID || object.Name == created.Name {
			return errors.New("cloudreve_cleanup_not_confirmed")
		}
	}
	return nil
}
