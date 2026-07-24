# GMAO Production Deployment Guide

## Overview

This guide covers deploying GMAO (Gestion de Maintenance Assistée par
Ordinateur) to a production environment using Docker, Docker Compose, MongoDB,
Redis, and Nginx.

## Prerequisites

- Docker & Docker Compose installed (version 20.10+)
- 4GB RAM minimum (8GB recommended)
- 50GB disk space (accounting for audit logs, uploads, database)
- Domain name with valid SSL certificate (or use Let's Encrypt)
- Linux server (Ubuntu 20.04 LTS or similar recommended)

## Architecture

```text
Client (Browser/App)
    ↓ HTTPS (443)
Nginx (Reverse Proxy, Rate Limiting, Security Headers)
    ↓ HTTP (3001)
Backend (Node.js/NestJS API)
    ↓
MongoDB (Data Persistence)
Redis (Session Store, Rate Limiting Cache)
```

## Pre-Deployment Setup

### 1. Prepare Environment

```bash
# Clone repository
git clone <repo-url> gmao
cd gmao

# Create .env from template
cp .env.example .env

# Edit .env with your values
nano .env
```

### 2. Generate Secrets

```bash
# Generate strong JWT secrets (32+ characters)
openssl rand -base64 32  # Use for JWT_SECRET
openssl rand -base64 32  # Use for JWT_REFRESH_SECRET

# Generate strong database password
openssl rand -base64 24  # Use for MONGODB_ROOT_PASSWORD
openssl rand -base64 24  # Use for REDIS_PASSWORD
```

### 3. Prepare SSL Certificates

### Option A: Let's Encrypt (Recommended)

```bash
# Install certbot
sudo apt-get install certbot certbot-nginx

# Generate certificate
sudo certbot certonly --standalone -d yourdomain.com -d www.yourdomain.com

# Copy to project
mkdir -p ssl
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem ssl/cert.pem
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem ssl/key.pem
sudo chown $(id -u):$(id -g) ssl/*
```

### Option B: Self-Signed Certificate (Development Only)

```bash
mkdir -p ssl
openssl req -x509 -newkey rsa:4096 -keyout ssl/key.pem \
  -out ssl/cert.pem -days 365 -nodes
```

### 4. Configure Nginx

The `nginx.conf` is pre-configured with:

- TLS 1.2+ enforcement
- Rate limiting (login: 5req/min, API: 60req/min)
- Security headers (HSTS, CSP, X-Frame-Options, etc.)
- CORS proxy to backend
- Gzip compression
- Static file caching

### Public Avatar Policy

Approved, active user avatars are intentionally public profile assets. The backend may serve local development avatars from `/files/uploads/avatars/*`, and API responses generate avatar URLs only for active approved users or legacy active users without an approval status. Protected documents and maintenance attachments must never be exposed through static upload routes; they are served through authenticated document endpoints.

Review and customize as needed:

```bash
nano nginx.conf
```

## Deployment

### 1. Build and Start Services

```bash
# From project root
docker-compose up -d

# Verify services are running
docker-compose ps

# Check logs
docker-compose logs -f backend
docker-compose logs -f mongodb
docker-compose logs -f redis
docker-compose logs -f nginx
```

### 2. Verify Services

```bash
# Health check endpoint (should return 200 OK)
curl -k https://localhost/health/api

# Check MongoDB connection
docker-compose exec mongodb mongosh --eval 'db.adminCommand("ping")'

# Check Redis connection
docker-compose exec redis redis-cli ping

# View running containers
docker ps
```

### 3. Initialize Database (First Time Only)

```bash
# Create indexes
docker-compose exec backend node -e "
  const mongoose = require('mongoose');
  mongoose.connect(process.env.MONGODB_URI).then(() => {
    console.log('Connected to MongoDB');
    process.exit(0);
  }).catch(e => {
    console.error('Connection failed:', e);
    process.exit(1);
  });
"
```

## Operational Tasks

### Backup

```bash
# Backup MongoDB
docker-compose exec mongodb mongodump \
  --authenticationDatabase admin \
  --username admin \
  --password changeme \
  --out /backup/mongodb-$(date +%Y%m%d)

# Backup Redis
docker-compose exec redis redis-cli \
  --rdb /backup/redis-$(date +%Y%m%d).rdb

# Backup uploaded files
tar -czf backup/files-$(date +%Y%m%d).tar.gz uploads/
```

### Restore

```bash
# Restore MongoDB
docker-compose exec mongodb mongorestore \
  --authenticationDatabase admin \
  --username admin \
  --password changeme \
  /backup/mongodb-20240101

# Restore Redis
docker-compose exec redis redis-cli \
  < /backup/redis-20240101.rdb
```

### Prune Audit Logs

```bash
# Manually trigger audit log cleanup
docker-compose exec backend npm run prune-audit-logs

# Or schedule via cron (runs daily at 2 AM)
0 2 * * * cd /path/to/gmao && docker-compose exec -T backend npm run prune-audit-logs
```

### View Audit Logs

```bash
# Search audit logs (admin only)
curl -X GET 'http://localhost:3001/admin/audit/search?severity=CRITICAL' \
  -H 'Authorization: Bearer <jwt_token>'

# Get statistics
curl -X GET 'http://localhost:3001/admin/audit/stats/summary' \
  -H 'Authorization: Bearer <jwt_token>'
```

## Scaling & Performance

### Resource Limits

Edit `docker-compose.yml` to add resource limits:

```yaml
services:
  backend:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G
```

### Multiple Backend Replicas (with Load Balancer)

```yaml
services:
  backend-1:
    build: ...
    environment:
      INSTANCE_ID: 1
  backend-2:
    build: ...
    environment:
      INSTANCE_ID: 2
  backend-3:
    build: ...
    environment:
      INSTANCE_ID: 3
```

Then update Nginx upstream:

```nginx
upstream backend {
  least_conn;
  server backend-1:3001 max_fails=3 fail_timeout=30s;
  server backend-2:3001 max_fails=3 fail_timeout=30s;
  server backend-3:3001 max_fails=3 fail_timeout=30s;
  keepalive 32;
}
```

## Monitoring & Logging

### Container Logs

```bash
# View real-time logs
docker-compose logs -f

# View logs for specific service
docker-compose logs -f backend

# View logs with timestamps
docker-compose logs --timestamps

# View last 100 lines
docker-compose logs --tail=100
```

### Metrics

Install monitoring stack (Prometheus, Grafana):

```bash
# Example prometheus config
docker run -d \
  -p 9090:9090 \
  -v prometheus.yml:/etc/prometheus/prometheus.yml \
  prom/prometheus
```

### Health Checks

The application exposes health checks at `/health/api`. Configure external monitoring:

```bash
# Nagios/Icinga
check_http -H yourdomain.com -u /health/api -S

# Uptime Robot
https://yourdomain.com/health/api
```

## Security Maintenance

### Regular Updates

```bash
# Update Docker images
docker-compose pull
docker-compose up -d

# Update Node.js dependencies
docker-compose exec backend npm update
docker-compose exec backend npm audit fix
```

### Certificate Renewal (Let's Encrypt)

```bash
# Renew certificates
sudo certbot renew

# Copy renewed cert
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem ssl/cert.pem
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem ssl/key.pem
sudo chown $(id -u):$(id -g) ssl/*

# Restart Nginx
docker-compose restart nginx
```

### Audit Log Review

```bash
# Check for security events
docker-compose exec backend node -e "
  const mongoose = require('mongoose');
  mongoose.connect(process.env.MONGODB_URI).then(async () => {
    const AuditLog = mongoose.model('AuditLog');
    const logs = await AuditLog.find({severity: 'CRITICAL'}).limit(10);
    console.log(JSON.stringify(logs, null, 2));
    process.exit(0);
  });
"
```

## Troubleshooting

### Backend not starting

```bash
# Check logs
docker-compose logs backend

# Check environment variables
docker-compose exec backend env | grep MONGODB

# Check database connectivity
docker-compose exec backend node -e "
  const mongoose = require('mongoose');
  mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Connected'))
    .catch(e => console.error('Failed:', e));
"
```

### High memory usage

```bash
# Check container stats
docker stats

# Restart services
docker-compose restart backend

# Check Redis memory
docker-compose exec redis redis-cli INFO memory
```

### Nginx 502 Bad Gateway

```bash
# Check backend health
docker-compose exec backend curl http://localhost:3001/health/api

# Check backend logs
docker-compose logs backend

# Restart backend
docker-compose restart backend
```

## Rollback

```bash
# If deployment fails, rollback to previous image
docker-compose down
git checkout previous-tag
docker-compose up -d
```

## Support & Documentation

- See `DEPLOYMENT_SECURITY_CHECKLIST.md` for security verification
- See `README.md` for API documentation
- See `backend/README.md` for application-specific details

## Contact & Issues

For issues, questions, or security concerns:

- Report via GitHub Issues
- Security issues: <security@yourdomain.com> (do not use public issues)
