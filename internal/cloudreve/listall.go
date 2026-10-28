package cloudreve

import (
	"context"
	"errors"
	"net/url"
	"strconv"
	"strings"
)

const (
	// directoryPageSize is the page this client asks for. A provider may cap it or
	// ignore paging entirely; the pass below never assumes it was honored.
	directoryPageSize = 100
	// directoryMaxPages bounds one complete listing. A node directory that needs
	// more pages than this is a configuration problem, and returning a truncated
	// list would let a caller confirm a deletion it never saw disappear.
	directoryMaxPages = 20
)

// ListAll returns every object of one directory.
//
// A single GET is not a listing. Cloudreve pages /directory, and this project's
// nodes mix app installers with archives that are never deleted, so a growing
// directory eventually has more objects than the first page holds. Callers that
// decide "this object is gone" (retention's confirm, the probe's read-back, the
// upload's post-condition) must see all of it, which is why completeness lives
// here instead of in each caller.
//
// The stop rule never trusts the requested page size: a provider that ignores
// paging answers every page with the same objects, and a provider that caps the
// size answers with fewer than asked. Both end the same way — the pass stops when
// a page adds nothing — so a paging-ignorant provider costs exactly one extra
// request, and no page size assumption can truncate the result.
func (c *Client) ListAll(ctx context.Context, directory string) (Listing, error) {
	if !strings.HasPrefix(directory, "/") {
		return Listing{}, errors.New("cloudreve_directory_invalid")
	}
	var out Listing
	seen := make(map[string]bool)
	for page := 1; page <= directoryMaxPages; page++ {
		query := url.Values{}
		query.Set("page", strconv.Itoa(page))
		query.Set("page_size", strconv.Itoa(directoryPageSize))
		var next Listing
		if err := c.do(ctx, "GET", "/directory"+directory+"?"+query.Encode(), nil, &next); err != nil {
			return Listing{}, err
		}
		if page == 1 {
			out.Policy = next.Policy
		}
		if len(next.Objects) == 0 {
			return out, nil
		}
		added := 0
		for _, object := range next.Objects {
			// Names are unique inside one directory, so they identify an object even
			// when the provider omits the ID.
			key := "id:" + object.ID
			if object.ID == "" {
				key = "name:" + object.Name
			}
			if seen[key] {
				continue
			}
			seen[key] = true
			out.Objects = append(out.Objects, object)
			added++
		}
		if added == 0 {
			return out, nil
		}
	}
	return Listing{}, errors.New("cloudreve_directory_listing_incomplete")
}
