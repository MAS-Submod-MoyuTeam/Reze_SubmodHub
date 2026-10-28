package cloudreve

import (
	"context"
	"errors"
	"slices"
	"strings"
)

// RemoveObjects deletes regular files the caller already identified in a
// directory listing it read itself. Deletion is always by object ID, never by
// name: a file that was replaced between that listing and this call keeps its
// new ID and therefore survives. The directory is re-read afterwards, and an ID
// that is still listed makes the call fail so no caller records a deletion that
// did not happen.
//
// Retention is the only automatic user of this: it removes superseded files that
// this server uploaded itself. Deleting a node's configuration still never
// deletes provider objects.
func (c *Client) RemoveObjects(ctx context.Context, directory string, ids []string) error {
	if !strings.HasPrefix(directory, "/") || len(ids) == 0 {
		return errors.New("cloudreve_cleanup_identity_invalid")
	}
	unique := make([]string, 0, len(ids))
	for _, id := range ids {
		if id == "" || strings.ContainsAny(id, "/\\?#") {
			return errors.New("cloudreve_cleanup_identity_invalid")
		}
		if !slices.Contains(unique, id) {
			unique = append(unique, id)
		}
	}
	// Cloudreve accepts the whole list, but batching bounds one request's payload
	// without changing the confirm-after-delete contract.
	for start := 0; start < len(unique); start += 100 {
		batch := unique[start:min(start+100, len(unique))]
		if err := c.do(ctx, "DELETE", "/object", map[string]any{"items": batch, "dirs": []string{}}, nil); err != nil {
			return err
		}
	}
	// The confirmation must see the whole directory, not one page: an ID on a later
	// page would otherwise look deleted.
	listing, err := c.ListAll(ctx, directory)
	if err != nil {
		return err
	}
	for _, object := range listing.Objects {
		if slices.Contains(unique, object.ID) {
			return errors.New("cloudreve_cleanup_not_confirmed")
		}
	}
	return nil
}
