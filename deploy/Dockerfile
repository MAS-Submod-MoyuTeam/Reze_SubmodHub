FROM scratch
COPY deploy/build/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --chmod=755 deploy/build/submodhub-linux-amd64 /submodhub
USER 65532:65532
ENV SUBMODHUB_ADDR=:8080 SUBMODHUB_DATA_DIR=/data
EXPOSE 8080
ENTRYPOINT ["/submodhub"]
