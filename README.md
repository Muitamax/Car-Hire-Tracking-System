# Car Hire Tracking System

A comprehensive real-time car hire tracking system with fleet management, booking system, and operational analytics.

## Features

### 🚗 Fleet Management
- Real-time GPS tracking of vehicles
- Vehicle status monitoring (Available, Booked, In-use, Maintenance)
- Location history and route tracking
- Fuel level and odometer monitoring

### 📅 Booking System
- Online vehicle booking with availability checking
- Concurrency protection to prevent double-bookings
- Flexible booking periods and pricing
- Booking management and cancellation

### 🗺️ Real-time Tracking
- WebSocket-based live location updates
- Interactive map visualization
- Geo-fencing with violation alerts
- Speed and movement monitoring

### 📊 Analytics Dashboard
- Revenue analytics and reporting
- Vehicle utilization metrics
- Trip statistics and performance
- Customer activity insights

### 🔔 Alert System
- Real-time alerts for geo-fence violations
- Maintenance scheduling reminders
- Anomaly detection and fraud prevention
- Custom alert rules and notifications

### 🛡️ Security Features
- JWT-based authentication
- Role-based access control (Admin, Customer)
- API rate limiting and security headers
- Input validation and SQL injection prevention

## Technology Stack

### Backend
- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: PostgreSQL 14+ with PostGIS
- **Cache**: Redis
- **Real-time**: Socket.io
- **Authentication**: JWT

### Frontend
- **Framework**: React 18+
- **State Management**: React Context
- **Maps**: Leaflet + OpenStreetMap
- **UI**: Tailwind CSS
- **Real-time**: Socket.io-client

### Infrastructure
- **Process Manager**: PM2
- **Web Server**: Nginx
- **SSL**: Let's Encrypt
- **Containerization**: Docker (optional)

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- Redis 6+
- Nginx (for production)

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/your-org/car-hire-tracking.git
cd car-hire-tracking
```

2. **Backend Setup**
```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your configuration
```

3. **Database Setup**
```bash
# Create database
createdb car_hire_tracking

# Run schema
psql -d car_hire_tracking -f ../DATABASE_SCHEMA.sql
```

4. **Frontend Setup**
```bash
cd frontend
npm install
```

5. **Start Development Servers**
```bash
# Backend (in terminal 1)
cd backend
npm run dev

# Frontend (in terminal 2)
cd frontend
npm run dev
```

6. **Access the Application**
- Frontend: http://localhost:3001
- Backend API: http://localhost:3000
- Database: localhost:5432

## Demo Credentials

### Admin Account
- Email: admin@carhire.com
- Password: admin123

### Customer Account
- Email: customer@example.com
- Password: password123

## API Documentation

### Authentication Endpoints
- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User registration
- `POST /api/auth/refresh` - Token refresh
- `GET /api/auth/profile` - Get user profile

### Vehicle Endpoints
- `GET /api/vehicles` - List vehicles
- `GET /api/vehicles/:id` - Get vehicle details
- `POST /api/vehicles` - Create vehicle (Admin)
- `PUT /api/vehicles/:id` - Update vehicle (Admin)
- `GET /api/vehicles/:id/locations` - Get location history

### Booking Endpoints
- `GET /api/bookings` - List bookings
- `POST /api/bookings` - Create booking
- `PUT /api/bookings/:id` - Update booking
- `POST /api/bookings/:id/cancel` - Cancel booking
- `POST /api/bookings/:id/confirm` - Confirm booking (Admin)

### Trip Endpoints
- `GET /api/trips` - List trips
- `POST /api/trips/start` - Start trip
- `POST /api/trips/end` - End trip
- `GET /api/trips/:id` - Get trip details

### Analytics Endpoints
- `GET /api/analytics/dashboard` - Dashboard overview
- `GET /api/analytics/revenue` - Revenue analytics
- `GET /api/analytics/utilization` - Vehicle utilization
- `GET /api/analytics/trips` - Trip statistics

### WebSocket Events
- `subscribe_vehicle_tracking` - Subscribe to vehicle updates
- `vehicle_location_update` - Update vehicle location
- `start_trip` - Start a trip
- `end_trip` - End a trip
- `new_alert` - Real-time alert notifications

## Database Schema

The system uses PostgreSQL with the following main tables:

- **users** - User accounts and authentication
- **vehicles** - Vehicle fleet information
- **vehicle_categories** - Vehicle categories and pricing
- **bookings** - Booking reservations
- **trips** - Trip records and tracking
- **vehicle_locations** - GPS location history (partitioned)
- **alerts** - System alerts and notifications
- **geo_fences** - Geo-fencing boundaries
- **payments** - Payment records
- **maintenance_records** - Vehicle maintenance history

See [DATABASE_SCHEMA.sql](./DATABASE_SCHEMA.sql) for complete schema definition.

## Architecture

### System Components

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   React App     │    │   Nginx Proxy   │    │  Node.js API    │
│   (Frontend)    │◄──►│   (Load Balance)│◄──►│   (Backend)     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                                       │
                       ┌─────────────────┐           │
                       │  Redis Cache    │◄──────────┤
                       │  (Sessions)     │           │
                       └─────────────────┘           │
                                                       ▼
                                            ┌─────────────────┐
                                            │  PostgreSQL     │
                                            │  (Database)     │
                                            └─────────────────┘
```

### Real-time Architecture

- **WebSocket Server**: Socket.io for real-time communication
- **Location Updates**: Live GPS tracking with anomaly detection
- **Alert System**: Real-time notifications for violations and issues
- **Room-based Broadcasting**: Efficient message distribution

## Security

### Authentication & Authorization
- JWT tokens with refresh mechanism
- Role-based access control (Admin, Customer)
- Secure password hashing with bcrypt
- Session management with Redis

### API Security
- Rate limiting to prevent abuse
- CORS configuration for cross-origin requests
- Input validation and sanitization
- SQL injection prevention with ORM
- Security headers (Helmet.js)

### Data Protection
- Environment variable configuration
- Encrypted database connections
- Regular security updates
- Audit logging for sensitive operations

## Monitoring & Maintenance

### Application Monitoring
- PM2 process management
- Structured logging with Winston
- Health check endpoints
- Performance metrics

### Database Monitoring
- Query performance analysis
- Connection pool monitoring
- Automated backups
- Index optimization

### Alert Monitoring
- Real-time alert system
- Anomaly detection
- Fraud prevention
- Geo-fence violations

## Deployment

### Production Deployment
See [DEPLOYMENT.md](./DEPLOYMENT.md) for comprehensive deployment guide including:

- Server setup and configuration
- SSL certificate setup
- Load balancing with Nginx
- Process management with PM2
- Database optimization
- Security hardening
- Backup strategies

### Docker Deployment
Alternative deployment using Docker Compose:

```bash
docker-compose up -d --build
```

## Development

### Project Structure
```
car-hire-tracking/
├── backend/                 # Node.js API
│   ├── src/
│   │   ├── controllers/     # API handlers
│   │   ├── models/         # Database models
│   │   ├── middleware/     # Auth, validation
│   │   ├── routes/         # API routes
│   │   ├── services/       # Business logic
│   │   ├── utils/          # Helper functions
│   │   └── websocket/      # Real-time features
│   └── package.json
├── frontend/                # React App
│   ├── src/
│   │   ├── components/     # UI components
│   │   ├── pages/         # Route components
│   │   ├── contexts/      # React contexts
│   │   └── services/      # API services
│   └── package.json
├── DATABASE_SCHEMA.sql     # Database schema
├── DEPLOYMENT.md          # Deployment guide
└── README.md              # This file
```

### Contributing
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

### Code Style
- ESLint for JavaScript linting
- Prettier for code formatting
- Conventional commits for commit messages
- Component-based architecture for React

## Testing

### Backend Testing
```bash
cd backend
npm test                    # Run tests
npm run test:watch         # Watch mode
npm run test:coverage      # Coverage report
```

### Frontend Testing
```bash
cd frontend
npm test                    # Run tests
npm run test:coverage      # Coverage report
```

## Performance

### Optimization Features
- Database query optimization
- Connection pooling
- Redis caching
- Asset compression
- Lazy loading
- Pagination

### Scalability
- Horizontal scaling support
- Database read replicas
- Load balancing
- Microservices ready architecture

## Support

### Documentation
- [Architecture Overview](./ARCHITECTURE.md)
- [Deployment Guide](./DEPLOYMENT.md)
- [API Documentation](./docs/api.md)
- [Database Schema](./DATABASE_SCHEMA.sql)

### Troubleshooting
- Check logs in `/logs` directory
- Verify database connectivity
- Ensure Redis is running
- Check environment configuration

### Getting Help
- Create an issue on GitHub
- Check existing documentation
- Review troubleshooting guides

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built with modern web technologies
- Inspired by real-world fleet management needs
- Designed for scalability and performance
- Focused on security and reliability

---

**Car Hire Tracking System** - Modern fleet management solution for the digital age.
