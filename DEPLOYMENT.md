# Car Hire Tracking System - Deployment Guide

## Overview

This guide covers deployment of the Car Hire Tracking System in production environments. The system consists of a Node.js backend, React frontend, PostgreSQL database, and Redis for caching.

## Architecture

```
Internet → Nginx (Load Balancer) → Node.js App Cluster
                                      ↓
                                 PostgreSQL (Primary)
                                      ↓
                                 PostgreSQL (Read Replica)
                                      ↓
                                 Redis (Cache/Sessions)
```

## Prerequisites

### System Requirements

- **CPU**: Minimum 4 cores (8+ recommended)
- **RAM**: Minimum 8GB (16GB+ recommended)
- **Storage**: Minimum 100GB SSD
- **Network**: Stable internet connection with static IP

### Software Requirements

- **Operating System**: Ubuntu 20.04+ / CentOS 8+ / Amazon Linux 2
- **Node.js**: 18.x or higher
- **PostgreSQL**: 14.x or higher
- **Redis**: 6.x or higher
- **Nginx**: 1.18 or higher
- **Docker**: 20.x or higher (optional)
- **Docker Compose**: 2.x or higher (optional)

## Environment Setup

### 1. System Preparation

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install required packages
sudo apt install -y curl wget git build-essential

# Install Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Install Redis
sudo apt install -y redis-server

# Install Nginx
sudo apt install -y nginx

# Install PM2 for process management
sudo npm install -g pm2
```

### 2. Database Setup

```bash
# Switch to postgres user
sudo su - postgres

# Create database and user
psql
CREATE DATABASE car_hire_tracking;
CREATE USER carhire_user WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE car_hire_tracking TO carhire_user;
ALTER USER carhire_user CREATEDB;
\q

# Exit postgres user
exit
```

### 3. Application Deployment

#### Backend Setup

```bash
# Clone the repository
git clone https://github.com/your-org/car-hire-tracking.git
cd car-hire-tracking/backend

# Install dependencies
npm ci --production

# Create environment file
cp .env.example .env
nano .env
```

**Environment Configuration (.env):**
```bash
NODE_ENV=production
PORT=3000
HOST=localhost

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=car_hire_tracking
DB_USER=carhire_user
DB_PASSWORD=your_secure_password
DB_SSL=false

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# JWT Configuration
JWT_SECRET=your_super_secure_jwt_key_change_this_in_production
JWT_EXPIRES_IN=24h
JWT_REFRESH_EXPIRES_IN=7d

# CORS Configuration
CORS_ORIGIN=https://yourdomain.com

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Logging
LOG_LEVEL=info
LOG_FILE=logs/app.log

# Map Configuration
MAPBOX_ACCESS_TOKEN=your_mapbox_token
GOOGLE_MAPS_API_KEY=your_google_maps_api_key
```

#### Database Migration

```bash
# Run database schema
psql -U carhire_user -d car_hire_tracking -f ../DATABASE_SCHEMA.sql

# Or use Sequelize migrations (if implemented)
npm run migrate
```

#### Frontend Setup

```bash
cd ../frontend

# Install dependencies
npm ci

# Build for production
npm run build

# Configure environment variables
echo "VITE_API_URL=https://api.yourdomain.com/api" > .env.production
echo "VITE_WS_URL=wss://api.yourdomain.com" >> .env.production
```

### 4. Process Management

#### PM2 Configuration

Create `ecosystem.config.js` in the backend directory:

```javascript
module.exports = {
  apps: [{
    name: 'car-hire-api',
    script: 'src/app.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    max_memory_restart: '1G',
    node_args: '--max-old-space-size=1024'
  }]
};
```

#### Start Application

```bash
# Start with PM2
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 startup script
pm2 startup
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u carhire --hp /home/carhire
```

### 5. Nginx Configuration

Create `/etc/nginx/sites-available/car-hire-tracking`:

```nginx
# Backend API
upstream car_hire_api {
    server 127.0.0.1:3000;
    keepalive 64;
}

# Frontend static files
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    
    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;

    # SSL Configuration
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Security Headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Frontend static files
    location / {
        root /home/carhire/car-hire-tracking/frontend/dist;
        index index.html;
        try_files $uri $uri/ /index.html;
        
        # Cache static assets
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }

    # Backend API
    location /api/ {
        proxy_pass http://car_hire_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }

    # WebSocket support
    location /socket.io/ {
        proxy_pass http://car_hire_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

#### Enable Site

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/car-hire-tracking /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
```

### 6. SSL Certificate

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Obtain SSL certificate
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Setup auto-renewal
sudo crontab -e
# Add: 0 12 * * * /usr/bin/certbot renew --quiet
```

## Docker Deployment (Alternative)

### Docker Compose Configuration

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:14
    environment:
      POSTGRES_DB: car_hire_tracking
      POSTGRES_USER: carhire_user
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./DATABASE_SCHEMA.sql:/docker-entrypoint-initdb.d/init.sql
    ports:
      - "5432:5432"

  redis:
    image: redis:6-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

  backend:
    build: ./backend
    environment:
      NODE_ENV: production
      DB_HOST: postgres
      REDIS_HOST: redis
    depends_on:
      - postgres
      - redis
    ports:
      - "3000:3000"
    volumes:
      - ./backend/logs:/app/logs

  frontend:
    build: ./frontend
    ports:
      - "80:80"
    depends_on:
      - backend

volumes:
  postgres_data:
  redis_data:
```

### Docker Deployment Commands

```bash
# Build and start services
docker-compose up -d --build

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

## Monitoring and Maintenance

### 1. Application Monitoring

```bash
# PM2 Monitoring
pm2 monit

# View logs
pm2 logs

# Restart application
pm2 restart car-hire-api

# Check status
pm2 status
```

### 2. Database Monitoring

```bash
# Connect to database
psql -U carhire_user -d car_hire_tracking

# Check database size
SELECT pg_size_pretty(pg_database_size('car_hire_tracking'));

# Monitor active connections
SELECT count(*) FROM pg_stat_activity;
```

### 3. System Monitoring

```bash
# Check system resources
htop
df -h
free -h

# Monitor Nginx
sudo nginx -t
sudo systemctl status nginx

# Monitor Redis
redis-cli ping
redis-cli info memory
```

## Backup Strategy

### Database Backup

Create backup script `/home/carhire/scripts/backup-db.sh`:

```bash
#!/bin/bash
BACKUP_DIR="/home/carhire/backups"
DATE=$(date +%Y%m%d_%H%M%S)
DB_NAME="car_hire_tracking"

# Create backup directory
mkdir -p $BACKUP_DIR

# Create database backup
pg_dump -U carhire_user -h localhost $DB_NAME > $BACKUP_DIR/backup_$DATE.sql

# Compress backup
gzip $BACKUP_DIR/backup_$DATE.sql

# Remove backups older than 7 days
find $BACKUP_DIR -name "backup_*.sql.gz" -mtime +7 -delete

echo "Database backup completed: backup_$DATE.sql.gz"
```

### Automated Backups

```bash
# Make script executable
chmod +x /home/carhire/scripts/backup-db.sh

# Add to crontab (daily at 2 AM)
sudo crontab -e
# Add: 0 2 * * * /home/carhire/scripts/backup-db.sh
```

## Security Considerations

### 1. Application Security

- Use strong, unique passwords for all services
- Implement rate limiting on API endpoints
- Enable CORS only for trusted domains
- Use environment variables for sensitive configuration
- Regularly update dependencies
- Implement proper error handling without information leakage

### 2. Database Security

- Restrict database access to application user only
- Use SSL for database connections in production
- Implement regular database backups
- Monitor database access logs
- Use PostgreSQL row-level security for sensitive data

### 3. Network Security

- Configure firewall to allow only necessary ports
- Use fail2ban to prevent brute force attacks
- Implement DDoS protection
- Use Cloudflare or similar CDN for additional protection
- Regular security updates and patches

## Scaling Considerations

### Horizontal Scaling

1. **Application Servers**: Use PM2 cluster mode or multiple instances
2. **Database**: Implement read replicas for scaling read operations
3. **Load Balancer**: Use Nginx or dedicated load balancer
4. **Caching**: Implement Redis cluster for distributed caching
5. **CDN**: Use CloudFlare for static asset delivery

### Performance Optimization

1. **Database Indexing**: Ensure proper indexes on frequently queried columns
2. **Query Optimization**: Monitor and optimize slow queries
3. **Connection Pooling**: Use database connection pooling
4. **Caching Strategy**: Implement multi-level caching
5. **Asset Optimization**: Compress and minify frontend assets

## Troubleshooting

### Common Issues

1. **Application Won't Start**
   - Check environment variables
   - Verify database connection
   - Check log files for errors

2. **Database Connection Issues**
   - Verify database is running
   - Check connection credentials
   - Ensure network connectivity

3. **High Memory Usage**
   - Monitor memory usage with PM2
   - Implement memory leak detection
   - Optimize database queries

4. **WebSocket Connection Issues**
   - Check Nginx configuration
   - Verify CORS settings
   - Monitor connection limits

### Log Locations

- **Application Logs**: `/home/carhire/car-hire-tracking/backend/logs/`
- **Nginx Logs**: `/var/log/nginx/`
- **Database Logs**: `/var/log/postgresql/`
- **System Logs**: `/var/log/syslog`

## Support and Maintenance

### Regular Tasks

1. **Daily**: Monitor application health and logs
2. **Weekly**: Check system resources and performance
3. **Monthly**: Update dependencies and security patches
4. **Quarterly**: Review and optimize performance metrics

### Emergency Procedures

1. **Application Crash**: Restart with PM2 and investigate logs
2. **Database Issues**: Switch to read replica if available
3. **High Traffic**: Scale up resources temporarily
4. **Security Incident**: Follow incident response plan

This deployment guide provides a comprehensive foundation for deploying the Car Hire Tracking System in production environments with proper security, monitoring, and scaling considerations.
