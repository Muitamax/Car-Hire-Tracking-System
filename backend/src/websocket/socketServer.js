const { createServer } = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const { User, Vehicle, VehicleLocation, Booking, Alert } = require('../config/database').models;

let io;

const initializeSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || 'http://localhost:3001',
      methods: ['GET', 'POST'],
      credentials: true
    },
    transports: ['websocket', 'polling']
  });

  // Authentication middleware for Socket.io
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication error'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findByPk(decoded.id);
      
      if (!user || !user.is_active) {
        return next(new Error('Authentication error'));
      }

      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    logger.info(`WebSocket client connected: ${socket.user.email} (${socket.user.role})`);

    // Join user to their personal room
    socket.join(`user_${socket.user.id}`);

    // Join role-based rooms
    socket.join(`role_${socket.user.role}`);

    // Handle vehicle tracking subscription
    socket.on('subscribe_vehicle_tracking', async (data) => {
      try {
        const { vehicleIds } = data;
        
        if (!Array.isArray(vehicleIds)) {
          socket.emit('error', { message: 'vehicleIds must be an array' });
          return;
        }

        // Verify user has permission to track these vehicles
        if (socket.user.role === 'admin') {
          // Admin can track all vehicles
          vehicleIds.forEach(vehicleId => {
            socket.join(`vehicle_${vehicleId}`);
          });
          
          socket.emit('subscribed_to_vehicles', { vehicleIds });
          logger.info(`Admin ${socket.user.email} subscribed to ${vehicleIds.length} vehicles`);
        } else {
          // Customer can only track their booked vehicles
          const userBookings = await Booking.findAll({
            where: {
              customer_id: socket.user.id,
              status: ['confirmed', 'active']
            },
            attributes: ['vehicle_id']
          });

          const allowedVehicleIds = userBookings.map(booking => booking.vehicle_id);
          const requestedAllowedIds = vehicleIds.filter(id => allowedVehicleIds.includes(id));

          requestedAllowedIds.forEach(vehicleId => {
            socket.join(`vehicle_${vehicleId}`);
          });

          socket.emit('subscribed_to_vehicles', { vehicleIds: requestedAllowedIds });
          logger.info(`Customer ${socket.user.email} subscribed to ${requestedAllowedIds.length} vehicles`);
        }
      } catch (error) {
        logger.error('Vehicle subscription error:', error);
        socket.emit('error', { message: 'Failed to subscribe to vehicles' });
      }
    });

    // Handle location updates from vehicles
    socket.on('vehicle_location_update', async (data) => {
      try {
        // Only allow authenticated vehicle updates (in real system, this would use device tokens)
        if (socket.user.role !== 'admin') {
          socket.emit('error', { message: 'Unauthorized to update vehicle locations' });
          return;
        }

        const { vehicle_id, latitude, longitude, speed, heading } = data;

        // Validate location data
        if (!vehicle_id || !latitude || !longitude) {
          socket.emit('error', { message: 'Missing required location data' });
          return;
        }

        // Verify vehicle exists
        const vehicle = await Vehicle.findByPk(vehicle_id);
        if (!vehicle) {
          socket.emit('error', { message: 'Vehicle not found' });
          return;
        }

        // Save location to database
        const location = await VehicleLocation.create({
          vehicle_id,
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude),
          speed: speed ? parseFloat(speed) : null,
          heading: heading ? parseFloat(heading) : null,
          timestamp: new Date()
        });

        // Update vehicle's current location
        await vehicle.updateLocation(latitude, longitude);

        // Broadcast location update to subscribed clients
        const locationData = {
          vehicle_id,
          latitude,
          longitude,
          speed,
          heading,
          timestamp: location.timestamp
        };

        io.to(`vehicle_${vehicle_id}`).emit('location_update', locationData);
        
        // Also send to all admins
        io.to('role_admin').emit('location_update', locationData);

        logger.debug(`Location updated for vehicle ${vehicle_id}: ${latitude}, ${longitude}`);

      } catch (error) {
        logger.error('Location update error:', error);
        socket.emit('error', { message: 'Failed to update location' });
      }
    });

    // Handle trip start
    socket.on('start_trip', async (data) => {
      try {
        const { booking_id, start_latitude, start_longitude } = data;

        if (!booking_id || !start_latitude || !start_longitude) {
          socket.emit('error', { message: 'Missing required trip data' });
          return;
        }

        // Verify booking exists and belongs to user
        const booking = await Booking.findByPk(booking_id, {
          include: ['vehicle', 'customer']
        });

        if (!booking) {
          socket.emit('error', { message: 'Booking not found' });
          return;
        }

        // Check permissions
        if (socket.user.role === 'customer' && booking.customer_id !== socket.user.id) {
          socket.emit('error', { message: 'Unauthorized to start this trip' });
          return;
        }

        if (booking.status !== 'confirmed') {
          socket.emit('error', { message: 'Booking must be confirmed to start trip' });
          return;
        }

        // Update booking status
        await booking.updateStatus('active');

        // Create trip record
        const Trip = require('../models/Trip');
        const trip = await Trip.create({
          booking_id,
          vehicle_id: booking.vehicle_id,
          driver_id: booking.customer_id,
          start_time: new Date(),
          start_latitude,
          start_longitude,
          status: 'active'
        });

        // Broadcast trip start
        const tripData = {
          trip_id: trip.id,
          booking_id,
          vehicle_id: booking.vehicle_id,
          driver_id: booking.customer_id,
          start_time: trip.start_time,
          start_latitude,
          start_longitude
        };

        io.to(`vehicle_${booking.vehicle_id}`).emit('trip_started', tripData);
        io.to('role_admin').emit('trip_started', tripData);

        logger.info(`Trip started for booking ${booking_id} by ${socket.user.email}`);

      } catch (error) {
        logger.error('Trip start error:', error);
        socket.emit('error', { message: 'Failed to start trip' });
      }
    });

    // Handle trip end
    socket.on('end_trip', async (data) => {
      try {
        const { trip_id, end_latitude, end_longitude, end_odometer } = data;

        if (!trip_id || !end_latitude || !end_longitude) {
          socket.emit('error', { message: 'Missing required trip data' });
          return;
        }

        // Find trip
        const Trip = require('../models/Trip');
        const trip = await Trip.findByPk(trip_id, {
          include: ['booking', 'vehicle', 'driver']
        });

        if (!trip) {
          socket.emit('error', { message: 'Trip not found' });
          return;
        }

        // Check permissions
        if (socket.user.role === 'customer' && trip.driver_id !== socket.user.id) {
          socket.emit('error', { message: 'Unauthorized to end this trip' });
          return;
        }

        if (trip.status !== 'active') {
          socket.emit('error', { message: 'Trip is not active' });
          return;
        }

        // Calculate trip metrics
        const endTime = new Date();
        const durationMinutes = Math.round((endTime - trip.start_time) / (1000 * 60));

        // Calculate distance using location history
        const distance = await VehicleLocation.calculateDistance(
          trip.vehicle_id,
          trip.start_time,
          endTime
        );

        // Update trip record
        await trip.update({
          end_time: endTime,
          end_latitude,
          end_longitude,
          end_odometer: end_odometer || trip.start_odometer,
          distance_km: distance,
          duration_minutes: durationMinutes,
          status: 'completed'
        });

        // Calculate trip cost
        await require('../config/database').sequelize.query(
          'SELECT calculate_trip_cost(:trip_id)',
          {
            replacements: { trip_id },
            type: require('sequelize').QueryTypes.SELECT
          }
        );

        // Update booking status
        await trip.booking.updateStatus('completed');

        // Broadcast trip end
        const tripData = {
          trip_id: trip.id,
          booking_id: trip.booking_id,
          vehicle_id: trip.vehicle_id,
          driver_id: trip.driver_id,
          end_time: endTime,
          end_latitude,
          end_longitude,
          distance_km: distance,
          duration_minutes: durationMinutes,
          total_cost: trip.total_cost
        };

        io.to(`vehicle_${trip.vehicle_id}`).emit('trip_ended', tripData);
        io.to('role_admin').emit('trip_ended', tripData);

        logger.info(`Trip ended: ${trip_id} by ${socket.user.email}`);

      } catch (error) {
        logger.error('Trip end error:', error);
        socket.emit('error', { message: 'Failed to end trip' });
      }
    });

    // Handle alert subscriptions
    socket.on('subscribe_alerts', () => {
      if (socket.user.role === 'admin') {
        socket.join('alerts');
        socket.emit('subscribed_to_alerts');
        logger.info(`Admin ${socket.user.email} subscribed to alerts`);
      }
    });

    // Handle real-time vehicle status requests
    socket.on('get_vehicle_status', async (data) => {
      try {
        const { vehicle_id } = data;

        if (!vehicle_id) {
          socket.emit('error', { message: 'Vehicle ID required' });
          return;
        }

        const vehicle = await Vehicle.findByPk(vehicle_id);
        if (!vehicle) {
          socket.emit('error', { message: 'Vehicle not found' });
          return;
        }

        const latestLocation = await VehicleLocation.getLatestByVehicle(vehicle_id);

        const statusData = {
          vehicle_id,
          status: vehicle.status,
          location: latestLocation ? {
            latitude: latestLocation.latitude,
            longitude: latestLocation.longitude,
            timestamp: latestLocation.timestamp,
            speed: latestLocation.speed,
            heading: latestLocation.heading
          } : null,
          fuel_level: vehicle.fuel_level,
          odometer: vehicle.odometer,
          last_location_update: vehicle.last_location_update
        };

        socket.emit('vehicle_status', statusData);

      } catch (error) {
        logger.error('Vehicle status error:', error);
        socket.emit('error', { message: 'Failed to get vehicle status' });
      }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      logger.info(`WebSocket client disconnected: ${socket.user.email}`);
    });

    // Send welcome message
    socket.emit('connected', {
      message: 'Connected to Car Hire Tracking System',
      user: {
        id: socket.user.id,
        email: socket.user.email,
        role: socket.user.role
      },
      timestamp: new Date().toISOString()
    });
  });

  return io;
};

// Function to broadcast alerts
const broadcastAlert = (alert) => {
  if (io) {
    io.to('alerts').emit('new_alert', alert);
    io.to('role_admin').emit('new_alert', alert);
  }
};

// Function to broadcast vehicle status updates
const broadcastVehicleStatus = (vehicleId, status) => {
  if (io) {
    io.to(`vehicle_${vehicleId}`).emit('vehicle_status_update', {
      vehicle_id: vehicleId,
      status: status,
      timestamp: new Date().toISOString()
    });
    io.to('role_admin').emit('vehicle_status_update', {
      vehicle_id: vehicleId,
      status: status,
      timestamp: new Date().toISOString()
    });
  }
};

// Function to broadcast booking updates
const broadcastBookingUpdate = (booking) => {
  if (io) {
    io.to(`user_${booking.customer_id}`).emit('booking_update', booking);
    io.to('role_admin').emit('booking_update', booking);
  }
};

const createServer = (app) => {
  const server = require('http').createServer(app);
  initializeSocket(server);
  return server;
};

module.exports = {
  createServer,
  broadcastAlert,
  broadcastVehicleStatus,
  broadcastBookingUpdate
};
