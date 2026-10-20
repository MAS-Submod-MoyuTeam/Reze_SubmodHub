package cloudreve

import (
	"context"
	"sync"
)

// metadataMutex bounds waiting as well as network I/O by the caller context.
type metadataMutex struct {
	once sync.Once
	slot chan struct{}
}

func (m *metadataMutex) init() { m.once.Do(func() { m.slot = make(chan struct{}, 1) }) }
func (m *metadataMutex) LockContext(ctx context.Context) error {
	m.init()
	select {
	case m.slot <- struct{}{}:
		if err := ctx.Err(); err != nil {
			<-m.slot
			return err
		}
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
func (m *metadataMutex) Lock()   { _ = m.LockContext(context.Background()) }
func (m *metadataMutex) Unlock() { <-m.slot }
