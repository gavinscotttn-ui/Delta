#!/usr/bin/env bash
# Builds dist/Praxis.exe (Windows x64) from any OS. Requires Go 1.24+.
# Regenerate the icon/manifest resource with: go install github.com/tc-hib/go-winres@latest && go-winres make --arch amd64
set -euo pipefail
cd "$(dirname "$0")"
go vet ./...
GOOS=windows GOARCH=amd64 go vet ./...
go test ./...
mkdir -p dist
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-H windowsgui" -o dist/Praxis.exe .
echo "Built dist/Praxis.exe"
