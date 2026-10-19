package main

import (
	"errors"
	"sync"
)

var (
	errFileMutationInProgress = errors.New("文件变更正在进行，请完成后再安装应用更新")
	errAppUpdateExiting       = errors.New("应用正在安装更新，暂时无法进行文件变更")
)

// clientMutationGate coordinates persistent client writes with update shutdown.
// It does not serialize normal operations or replace the installer's own locks.
// Nested writes are safe: only an idle gate can claim the irreversible handoff.
type clientMutationGate struct {
	mu            sync.Mutex
	active        int
	updateClaimed bool
}

func (g *clientMutationGate) begin() (func(), error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.updateClaimed {
		return nil, errAppUpdateExiting
	}
	g.active++
	return func() {
		g.mu.Lock()
		g.active--
		g.mu.Unlock()
	}, nil
}

func (g *clientMutationGate) claimUpdate() error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.updateClaimed {
		return errAppUpdateExiting
	}
	if g.active > 0 {
		return errFileMutationInProgress
	}
	g.updateClaimed = true
	return nil
}

func (g *clientMutationGate) releaseUpdate() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.updateClaimed = false
}
