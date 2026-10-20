FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY internal ./internal
COPY cmd/download-node ./cmd/download-node
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /download-node ./cmd/download-node

FROM alpine:3.22
RUN apk add --no-cache ca-certificates
COPY --from=build /download-node /download-node
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/download-node"]
