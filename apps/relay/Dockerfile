# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM golang:1.27.3-alpine AS build
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags="-s -w" -o /out/mains-relay ./cmd/mains-relay

FROM alpine:3.24.3
RUN addgroup -S -g 65532 mains && adduser -S -D -H -u 65532 -G mains mains
COPY --from=build /out/mains-relay /usr/local/bin/mains-relay
USER 65532:65532
EXPOSE 8791
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8791/health || exit 1
ENTRYPOINT ["/usr/local/bin/mains-relay"]
CMD ["-listen", "0.0.0.0:8791", "-secret-file", "/run/secrets/relay_routing"]
