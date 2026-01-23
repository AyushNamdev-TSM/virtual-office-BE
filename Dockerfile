FROM alpine:latest AS builder

WORKDIR /app
COPY . .

FROM alpine:latest

WORKDIR /app

RUN apk add --no-cache curl

COPY --from=builder /app /app

RUN chmod +x /app/app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 CMD curl -f http://localhost:8080/health || exit 1

CMD ["/app/app"]