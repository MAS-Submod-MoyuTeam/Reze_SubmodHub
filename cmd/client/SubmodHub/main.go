package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	service := NewDesktopService()
	app := application.New(application.Options{
		Name: "SubmodHub", Description: "MAS submod manager",
		Services: []application.Service{application.NewService(service)},
		Assets: application.AssetOptions{Handler: application.AssetFileServerFS(assets)},
	})
	app.Window.NewWithOptions(application.WebviewWindowOptions{Title: "SubmodHub", Width: 1280, Height: 800, BackgroundColour: application.NewRGB(10, 12, 16), URL: "/"})
	if err := app.Run(); err != nil { log.Fatal(err) }
}
