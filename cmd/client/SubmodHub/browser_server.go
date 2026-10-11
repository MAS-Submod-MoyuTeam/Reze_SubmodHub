package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

type browserRequest struct {
	Args []json.RawMessage `json:"args"`
}

func browserServiceHandler(service *DesktopService) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
			http.Error(w, "invalid_request", http.StatusBadRequest)
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" && origin != "http://127.0.0.1:9245" {
			http.Error(w, "invalid_origin", http.StatusForbidden)
			return
		}
		var request browserRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 180<<20)).Decode(&request); err != nil {
			http.Error(w, "invalid_json", http.StatusBadRequest)
			return
		}
		arg := func(index int, target any) error {
			if index >= len(request.Args) {
				return errors.New("missing_argument")
			}
			return json.Unmarshal(request.Args[index], target)
		}
		var result any
		var err error
		switch strings.TrimPrefix(r.URL.Path, "/local/") {
		case "ListMASInstances":
			result, err = service.ListMASInstances()
		case "ListInstalledArchives":
			result, err = service.ListInstalledArchives()
		case "ScanLocalSubmods":
			result, err = service.ScanLocalSubmods()
		case "ScanInstalledSpritepacks":
			result, err = service.ScanInstalledSpritepacks()
		case "GetMASStatus":
			result, err = service.GetMASStatus()
		case "ListInstalledModFiles":
			var installationID, modID string
			if err = arg(0, &installationID); err == nil {
				_ = arg(1, &modID)
				result, err = service.ListInstalledModFiles(installationID, modID)
			}
		case "AddMASInstance":
			var label, root string
			if err = arg(0, &label); err == nil {
				err = arg(1, &root)
			}
			if err == nil {
				result, err = service.AddMASInstance(label, root)
			}
		case "SelectMASInstance", "RemoveMASInstance", "LaunchMASInstance", "SetMASRoot", "CreateSpriteGift", "DeleteSpritepack":
			var value string
			err = arg(0, &value)
			if err == nil {
				switch strings.TrimPrefix(r.URL.Path, "/local/") {
				case "SelectMASInstance":
					result, err = service.SelectMASInstance(value)
				case "RemoveMASInstance":
					result, err = service.RemoveMASInstance(value)
				case "LaunchMASInstance":
					err = service.LaunchMASInstance(value)
					result = true
				case "SetMASRoot":
					result, err = service.SetMASRoot(value)
				case "CreateSpriteGift":
					result, err = service.CreateSpriteGift(value)
				case "DeleteSpritepack":
					result, err = service.DeleteSpritepack(value)
				}
			}
				case "StageArchive":
			var value StageArchiveRequest
			err = arg(0, &value)
			if err == nil {
				result, err = service.StageArchive(value)
			}
		case "GetStageProgress":
			var opID string
			err = arg(0, &opID)
			if err == nil {
				result, err = service.GetStageProgress(opID)
			}
		case "ReleaseArchive":
			var archiveID string
			err = arg(0, &archiveID)
			if err == nil {
				err = service.ReleaseArchive(archiveID)
				result = true
			}
		case "CancelStage":
			var opID string
			err = arg(0, &opID)
			if err == nil {
				err = service.CancelStage(opID)
				result = true
			}
		case "PreviewArchive":
			var value ArchiveInstallRequest
			err = arg(0, &value)
			if err == nil {
				result, err = service.PreviewArchive(value)
			}
		case "PreviewUninstall":
			var value string
			err = arg(0, &value)
			if err == nil {
				result, err = service.PreviewUninstall(value)
			}
		case "ExecutePlan":
			var value ExecutePlanRequest
			err = arg(0, &value)
			if err == nil {
				result, err = service.ExecutePlan(value)
			}
		case "ApplyArchive":
			var value ArchiveInstallRequest
			err = arg(0, &value)
			if err == nil {
				result, err = service.ApplyArchive(value)
			}
		case "Uninstall":
			var operationID, uninstallID string
			if err = arg(0, &operationID); err == nil {
				err = arg(1, &uninstallID)
			}
			if err == nil {
				result, err = service.Uninstall(operationID, uninstallID)
			}
		case "Recover":
			var value string
			err = arg(0, &value)
			if err == nil {
				err = service.Recover(value)
				result = true
			}
		default:
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		_ = json.NewEncoder(w).Encode(result)
	})
}
