package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"path/filepath"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

// NewPostgresStore uses PostgreSQL for catalog metadata and a mounted volume
// for archive bytes.
func NewPostgresStore(ctx context.Context, dsn, dataDir string, initial Catalog) (*Store, error) {
	if dsn == "" {
		return nil, errors.New("POSTGRES_DSN is required")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)
	if err = db.PingContext(ctx); err != nil {
		db.Close()
		return nil, err
	}
	if _, err = db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS catalog_snapshot (id integer PRIMARY KEY CHECK (id = 1), document jsonb NOT NULL)`); err != nil {
		db.Close()
		return nil, err
	}
	if _, err = db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS auth_sessions (token_hash text PRIMARY KEY, document jsonb NOT NULL, expires_at timestamptz NOT NULL)`); err != nil {
		db.Close()
		return nil, err
	}
	s, err := newArchiveStore(dataDir, initial)
	if err != nil {
		db.Close()
		return nil, err
	}
	var document []byte
	err = db.QueryRowContext(ctx, "SELECT document FROM catalog_snapshot WHERE id = 1").Scan(&document)
	if err == nil {
		if err = json.Unmarshal(document, &s.Catalog); err != nil {
			db.Close()
			return nil, err
		}
		if s.Catalog.Versions == nil {
			s.Catalog.Versions = map[string]Version{}
		}
		for id, version := range s.Catalog.Versions {
			if version.ArchivePath != "" {
				version.ArchivePath = filepath.Join(s.DataDir, "archives", filepath.Base(version.ArchivePath))
				s.Catalog.Versions[id] = version
			}
		}
	} else if errors.Is(err, sql.ErrNoRows) {
		b, marshalErr := json.Marshal(s.Catalog)
		if marshalErr != nil {
			db.Close()
			return nil, marshalErr
		}
		if _, err = db.ExecContext(ctx, "INSERT INTO catalog_snapshot (id, document) VALUES (1, $1)", b); err != nil {
			db.Close()
			return nil, err
		}
	} else {
		db.Close()
		return nil, err
	}
	s.DB = db
	return s, nil
}
