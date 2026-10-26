# Distributed System Improvement To-do

The current stack is a useful single-host demonstration, but several parts
are not yet highly available or horizontally scalable. Work through these
improvements in order.

## 1. Move beyond single-host Compose

- [ ] Deploy across multiple nodes using Kubernetes or a managed container
  platform.
- [ ] Route external traffic through a managed load balancer or ingress.
- [ ] Use platform service discovery, health-based routing, automatic restarts,
  and replica scaling.
- [ ] Keep Docker Compose as the local development environment.
- [ ] Revisit the Keepalived VIPs and published presentation port; they do not
  provide host-level high availability in a single-host Compose deployment.

## 2. Remove single-instance data dependencies

- [x] Move MongoDB to a managed service or configure a properly operated
  replica set. (Configured 3-node MongoDB Replica Set `rs0` with keyfile auth and automatic primary failover).
- [x] Move Redis to a managed service or configure an appropriate
  high-availability mode. (Configured Redis Primary-Replica with HAProxy TCP health-checking failover).
- [x] Decide whether Redis is a disposable cache or whether its data must
  survive failures. (Configured as persistent cache with AOF `appendonly yes` and RDB snapshots to prevent cache stampedes).
- [ ] Add monitoring and backup/restore plans for MariaDB.
- [ ] Test database restore procedures regularly.

## 3. Make database routing cluster-aware

- [x] Stop connecting application nodes directly to `galera1`. (App nodes now connect to `database-lb`).
- [x] Add a database-aware proxy or managed endpoint for failover and
  connection routing. (HAProxy `database-lb` handles health probes and automatic failover).
- [x] Define read/write routing behavior for the Galera cluster. (Port 3306 configured as Single-Writer Primary with hot backups to prevent deadlocks; Port 3307 configured for round-robin read distribution).
- [x] Review database connection-pool limits as application replicas scale. (Connection pool tuned to 10 max connections per node, keeping total cluster connections safely bounded under Galera max_connections limits).

## 4. Improve cache behavior

- [ ] Define cache keys and TTLs for each cached query.
- [ ] Invalidate affected cache entries when catalog data changes.
- [ ] Add cache-stampede protection so concurrent cache misses do not all query
  MariaDB.
- [ ] Keep the cache-clear API scoped to the intended application cache keys.

## 5. Add production observability

- [ ] Instrument the presentation, API, and database calls with OpenTelemetry.
- [ ] Collect logs, metrics, and traces centrally.
- [ ] Add dashboards and alerts for latency, error rates, resource saturation,
  database health, and cache hit rate.
- [ ] Replace the custom trace headers and UI with distributed traces that
  include timings and cross-service spans.
- [ ] Review the current trace UI and service wiring in
  [catalog.js](./web/catalog.js), [index.js](./application/index.js), and
  [docker-compose.yml](./docker-compose.yml).

## 6. Tighten security and operations

- [ ] Create a least-privilege MongoDB application user instead of using the
  MongoDB root account.
- [ ] Protect Redis if it is reachable beyond a trusted private network.
- [ ] Manage secrets outside checked-in environment files.
- [ ] Add TLS at the public ingress.
- [ ] Add API authentication and rate limiting where appropriate.
- [ ] Adopt database migrations.
- [ ] Document operational and recovery procedures.

## Suggested implementation order

1. Replace the single MongoDB and Redis instances with managed or replicated
   equivalents.
2. Add a database-aware MariaDB endpoint.
3. Move stateless web and API replicas to a multi-node scheduler.
4. Replace custom traces with distributed tracing.
