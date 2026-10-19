//go:build windows

package main

import (
	"errors"
	"flag"
	"fmt"
	"github.com/reze/submodhub/internal/updater"
	winupdate "github.com/reze/submodhub/internal/updater/windows"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

func main() {
	taskPath := flag.String("task", "", "Path to update task JSON")
	recoverOnly := flag.Bool("recover", false, "Recover interrupted updates")
	target := flag.String("target", "", "Target executable to recover")
	waitPID := flag.Int("wait-pid", 0, "Wait for startup process to exit before recovery")
	flag.Parse()
	if *waitPID > 0 {
		if err := winupdate.WaitForProcessExit(*waitPID, 30*time.Second); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	}
	var err error
	if *recoverOnly || *taskPath == "" {
		if *target != "" {
			err = winupdate.RecoverTaskFile(updater.StableTaskPath(*target))
		} else {
			exe, e := os.Executable()
			if e != nil {
				err = e
			} else {
				err = winupdate.RecoverDirectory(filepath.Dir(exe))
			}
			// Working directory is also a stable application location for staged updater launches.
			if cwd, e := os.Getwd(); e == nil {
				err = errors.Join(err, winupdate.RecoverDirectory(cwd))
			}
		}
	} else {
		var task *winupdate.UpdateTask
		task, err = winupdate.ReadTaskFile(*taskPath)
		if err == nil {
			var logger *winupdate.Logger
			logger, err = winupdate.NewLogger(task.LogPath)
			if err == nil {
				defer logger.Close()
				err = winupdate.ExecuteTransaction(task, logger)
			}
		}
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if *waitPID > 0 && *target != "" {
		cmd := exec.Command(*target)
		if err := cmd.Start(); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		_ = cmd.Process.Release()
	}
	// Retain terminal task checkpoint so discovery and concurrent invocations cannot replay it.
}
