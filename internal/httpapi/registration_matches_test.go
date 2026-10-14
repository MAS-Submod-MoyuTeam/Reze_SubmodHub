package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	packagezip "github.com/reze/submodhub/internal/package"
)

func TestMatchRegistrationsRulesAndPriority(t *testing.T) {
	catalog := Catalog{
		Mods: []Mod{
			{ID: "single_mod", Title: "Single Mod Title", LatestVersionID: "v_single"},
			{ID: "multi_mod", Title: "Multi Mod Title"},
			{ID: "ambig1_mod", Title: "Ambiguous 1"},
			{ID: "ambig2_mod", Title: "Ambiguous 2"},
			{ID: "unknown_mod", Title: "Unknown Mod"},
		},
		Versions: map[string]Version{
			"v_single": {
				ID:           "v_single",
				ModID:        "single_mod",
				Version:      "1.0.0",
				State:        "published",
				ScanReportID: "scan_single",
			},
			"v_single_v2": {
				ID:           "v_single_v2",
				ModID:        "single_mod",
				Version:      "2.0.0",
				State:        "published",
				ScanReportID: "scan_single_v2",
			},
			"v_multi": {
				ID:           "v_multi",
				ModID:        "multi_mod",
				Version:      "1.5.0",
				State:        "published",
				ScanReportID: "scan_multi",
			},
			"v_ambig1": {
				ID:           "v_ambig1",
				ModID:        "ambig1_mod",
				Version:      "0.1",
				State:        "published",
				ScanReportID: "scan_ambig1",
			},
			"v_ambig2": {
				ID:           "v_ambig2",
				ModID:        "ambig2_mod",
				Version:      "0.2",
				State:        "published",
				ScanReportID: "scan_ambig2",
			},
			"v_unknown": {
				ID:           "v_unknown",
				ModID:        "unknown_mod",
				Version:      "0.9",
				State:        "published",
				ScanReportID: "scan_unknown",
			},
			"v_unpublished": {
				ID:           "v_unpublished",
				ModID:        "unpub_mod",
				Version:      "9.9",
				State:        "draft",
				ScanReportID: "scan_unpub",
			},
		},
		ScanReports: map[string]packagezip.Report{
			"scan_single": {
				Submods: []packagezip.Registration{
					{Name: "Core Library", Author: "Author A", Version: "1.0.0"},
				},
			},
			"scan_single_v2": {
				Submods: []packagezip.Registration{
					{Name: "Core Library", Author: "Author A", Version: "2.0.0"},
				},
			},
			"scan_multi": {
				Submods: []packagezip.Registration{
					{Name: "Core Library", Author: "Author B", Version: "1.5.0"},
					{Name: "Extra Feature", Author: "Author B", Version: "1.5.0"},
				},
			},
			"scan_ambig1": {
				Submods: []packagezip.Registration{
					{Name: "Shared Name", Author: "Author 1", Version: "0.1"},
				},
			},
			"scan_ambig2": {
				Submods: []packagezip.Registration{
					{Name: "Shared Name", Author: "Author 2", Version: "0.2"},
				},
			},
			"scan_unknown": {
				Submods: []packagezip.Registration{
					{Name: "HasUnknown", Author: "Author U", Version: "0.9"},
					{Unknown: true},
				},
			},
			"scan_unpub": {
				Submods: []packagezip.Registration{
					{Name: "Unpublished Name", Version: "9.9"},
				},
			},
		},
	}

	// 1. Single registration preferred over multi registration: "Core Library"
	res := findRegistrationMatches(catalog, []string{"Core Library"})
	if len(res) != 1 {
		t.Fatalf("expected 1 result, got %d", len(res))
	}
	if res[0].Status != "matched" {
		t.Errorf("expected matched status for single preferred, got %s", res[0].Status)
	}
	// Candidates returned: single_mod (score 0) first, multi_mod (score 1) second
	if len(res[0].Candidates) != 2 {
		t.Fatalf("expected 2 candidates (deduped across versions), got %d", len(res[0].Candidates))
	}
	if res[0].Candidates[0].ModID != "single_mod" || res[0].Candidates[0].Priority != "single_registration" {
		t.Errorf("candidate 0 mismatch: %+v", res[0].Candidates[0])
	}
	if res[0].Candidates[1].ModID != "multi_mod" || res[0].Candidates[1].Priority != "multi_registration" {
		t.Errorf("candidate 1 mismatch: %+v", res[0].Candidates[1])
	}
	// Evidence check for version deduplication
	if len(res[0].Candidates[0].Evidence) != 2 { // v1.0.0 and v2.0.0
		t.Errorf("expected 2 version evidence items for single_mod, got %+v", res[0].Candidates[0].Evidence)
	}

	// 2. Ambiguity: two single-registration candidates for "Shared Name"
	ambigRes := findRegistrationMatches(catalog, []string{"Shared Name"})
	if len(ambigRes) != 1 || ambigRes[0].Status != "ambiguous" {
		t.Fatalf("expected ambiguous, got %+v", ambigRes)
	}
	if len(ambigRes[0].Candidates) != 2 {
		t.Fatalf("expected 2 candidates for ambiguous match, got %d", len(ambigRes[0].Candidates))
	}

	// 3. Unknown registration does not get single-registration priority: "HasUnknown"
	unkRes := findRegistrationMatches(catalog, []string{"HasUnknown"})
	if len(unkRes) != 1 || unkRes[0].Status != "matched" {
		t.Fatalf("expected matched status, got %+v", unkRes)
	}
	if unkRes[0].Candidates[0].Priority != "multi_registration" || unkRes[0].Candidates[0].Score != 1 {
		t.Errorf("candidate with unknown reg should be downgraded to multi_registration score 1, got %+v", unkRes[0].Candidates[0])
	}

	// 4. Unpublished versions excluded: "Unpublished Name"
	unpubRes := findRegistrationMatches(catalog, []string{"Unpublished Name"})
	if len(unpubRes) != 1 || unpubRes[0].Status != "no_match" {
		t.Fatalf("expected no_match for unpublished version, got %+v", unpubRes)
	}

	// 5. HTTP Endpoint test with deduplication and limits
	store, err := NewStore(t.TempDir(), catalog)
	if err != nil {
		t.Fatal(err)
	}
	handler := NewStoreHandler(store)

	body, _ := json.Marshal(MatchRegistrationsRequest{
		Names: []string{"Core Library", "Core Library", "Shared Name", "NonExistent"},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/registrations/match", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
	}
	var resp MatchRegistrationsResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	// "Core Library" was deduplicated, so 3 results: Core Library, Shared Name, NonExistent
	if len(resp.Results) != 3 {
		t.Fatalf("expected 3 results after deduplication, got %d", len(resp.Results))
	}
	if resp.Results[2].Status != "no_match" {
		t.Errorf("expected NonExistent to be no_match, got %s", resp.Results[2].Status)
	}

	// 6. Test GET /api/v1/mods/{id}/registrations
	reqRegs := httptest.NewRequest(http.MethodGet, "/api/v1/mods/single_mod/registrations", nil)
	wRegs := httptest.NewRecorder()
	handler.ServeHTTP(wRegs, reqRegs)
	if wRegs.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", wRegs.Code, wRegs.Body.String())
	}
	var regsResp struct {
		ModID         string   `json:"mod_id"`
		Registrations []string `json:"registrations"`
	}
	if err := json.Unmarshal(wRegs.Body.Bytes(), &regsResp); err != nil {
		t.Fatal(err)
	}
	if regsResp.ModID != "single_mod" || len(regsResp.Registrations) != 1 || regsResp.Registrations[0] != "Core Library" {
		t.Fatalf("unexpected registrations response: %+v", regsResp)
	}

	// 7. Non-existent mod returns 404
	req404 := httptest.NewRequest(http.MethodGet, "/api/v1/mods/nonexistent/registrations", nil)
	w404 := httptest.NewRecorder()
	handler.ServeHTTP(w404, req404)
	if w404.Code != http.StatusNotFound {
		t.Fatalf("expected 404 NotFound, got %d", w404.Code)
	}
}
