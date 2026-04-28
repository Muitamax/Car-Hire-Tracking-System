const express = require('express');
const Joi = require('joi');
const { VehicleLocation, Vehicle } = require('../config/database').models;
const { auth } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Validation schema for location update
const locationUpdateSchema = Joi.object({
  vehicle_id: Joi.string().uuid().required(),
  latitude: Joi.number().min(-90).max(90).required(),
  longitude: Joi.number().min(-180).max(180).required(),
  speed: Joi.number().min(0).max(500).optional(),
  heading: Joi.number().min(0).max(360).optional(),
  timestamp: Joi.date().iso().optional()
});

// Get latest locations for all vehicles
router.get('/latest', auth, async (req, res) => {
  try {
    const latestLocations = await VehicleLocation.getAllLatest();

    // Enrich with vehicle information
    const enrichedLocations = await Promise.all(
      latestLocations.map(async (location) => {
        const vehicle = await Vehicle.findByPk(location.vehicle_id, {
          attributes: ['id', 'make', 'model', 'license_plate', 'status']
        });
        return {
          ...location.toJSON(),
          vehicle: vehicle ? vehicle.toJSON() : null
        };
      })
    );

    res.json({
      locations: enrichedLocations,
      count: enrichedLocations.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Get latest locations error:', error);
    res.status(500).json({
      error: 'Failed to fetch latest locations',
      message: 'Internal server error'
    });
  }
});

// Get location history for a specific vehicle
router.get('/vehicle/:vehicle_id', auth, async (req, res) => {
  try {
    const { vehicle_id } = req.params;
    const { start_date, end_date, limit = 1000 } = req.query;

    // Verify vehicle exists
    const vehicle = await Vehicle.findByPk(vehicle_id);
    if (!vehicle) {
      return res.status(404).json({
        error: 'Vehicle not found',
        message: 'The requested vehicle does not exist'
      });
    }

    // Check permissions for customers
    if (req.user.role === 'customer') {
      const Booking = require('../models/Booking');
      const userBookings = await Booking.findAll({
        where: {
          customer_id: req.user.id,
          vehicle_id: vehicle_id,
          status: ['confirmed', 'active', 'completed']
        }
      });

      if (userBookings.length === 0) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'You can only view locations of vehicles you have booked'
        });
      }
    }

    let startDate = null;
    let endDate = null;

    if (start_date) {
      startDate = new Date(start_date);
    }
    if (end_date) {
      endDate = new Date(end_date);
    }

    const locations = await VehicleLocation.getHistoryByVehicle(
      vehicle_id,
      startDate,
      endDate,
      parseInt(limit)
    );

    res.json({
      vehicle_id,
      vehicle_info: {
        make: vehicle.make,
        model: vehicle.model,
        license_plate: vehicle.license_plate
      },
      locations: locations.map(loc => ({
        latitude: loc.latitude,
        longitude: loc.longitude,
        speed: loc.speed,
        heading: loc.heading,
        timestamp: loc.timestamp
      })),
      count: locations.length,
      period: {
        start_date: startDate,
        end_date: endDate
      }
    });
  } catch (error) {
    logger.error('Get vehicle location history error:', error);
    res.status(500).json({
      error: 'Failed to fetch location history',
      message: 'Internal server error'
    });
  }
});

// Add new location point
router.post('/', auth, async (req, res) => {
  try {
    const { error, value } = locationUpdateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.details.map(detail => detail.message)
      });
    }

    const { vehicle_id, latitude, longitude, speed, heading, timestamp } = value;

    // Verify vehicle exists
    const vehicle = await Vehicle.findByPk(vehicle_id);
    if (!vehicle) {
      return res.status(404).json({
        error: 'Vehicle not found',
        message: 'The requested vehicle does not exist'
      });
    }

    // Only admins can update vehicle locations
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Access denied',
        message: 'Only administrators can update vehicle locations'
      });
    }

    // Create location record
    const location = await VehicleLocation.create({
      vehicle_id,
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      speed: speed ? parseFloat(speed) : null,
      heading: heading ? parseFloat(heading) : null,
      timestamp: timestamp ? new Date(timestamp) : new Date()
    });

    // Update vehicle's current location
    await vehicle.updateLocation(latitude, longitude);

    // Broadcast location update via WebSocket
    const { broadcastVehicleStatus } = require('../websocket/socketServer');
    broadcastVehicleStatus(vehicle_id, vehicle.status);

    logger.info(`Location updated for vehicle ${vehicle_id}: ${latitude}, ${longitude}`);

    res.status(201).json({
      message: 'Location added successfully',
      location: {
        id: location.id,
        vehicle_id: location.vehicle_id,
        latitude: location.latitude,
        longitude: location.longitude,
        speed: location.speed,
        heading: location.heading,
        timestamp: location.timestamp
      }
    });
  } catch (error) {
    logger.error('Add location error:', error);
    res.status(500).json({
      error: 'Failed to add location',
      message: 'Internal server error'
    });
  }
});

// Get vehicles in a specific area
router.get('/nearby', auth, async (req, res) => {
  try {
    const { latitude, longitude, radius_km = 5 } = req.query;

    if (!latitude || !longitude) {
      return res.status(400).json({
        error: 'Missing parameters',
        message: 'latitude and longitude are required'
      });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    const radius = parseFloat(radius_km);

    // Validate coordinates
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({
        error: 'Invalid coordinates',
        message: 'Please provide valid latitude and longitude'
      });
    }

    const nearbyVehicles = await VehicleLocation.getVehiclesInArea(lat, lng, radius);

    // Enrich with vehicle information
    const enrichedVehicles = await Promise.all(
      nearbyVehicles.map(async (location) => {
        const vehicle = await Vehicle.findByPk(location.vehicle_id, {
          attributes: ['id', 'make', 'model', 'license_plate', 'status']
        });
        return {
          vehicle: vehicle ? vehicle.toJSON() : null,
          location: {
            latitude: location.latitude,
            longitude: location.longitude,
            timestamp: location.timestamp
          }
        };
      })
    );

    res.json({
      center: { latitude: lat, longitude: lng },
      radius_km: radius,
      vehicles: enrichedVehicles.filter(v => v.vehicle !== null),
      count: enrichedVehicles.filter(v => v.vehicle !== null).length
    });
  } catch (error) {
    logger.error('Get nearby vehicles error:', error);
    res.status(500).json({
      error: 'Failed to fetch nearby vehicles',
      message: 'Internal server error'
    });
  }
});

// Detect location anomalies
router.get('/anomalies/:vehicle_id', auth, authorize('admin'), async (req, res) => {
  try {
    const { vehicle_id } = req.params;
    const { max_speed_kmh = 200, max_jump_km = 5 } = req.query;

    // Verify vehicle exists
    const vehicle = await Vehicle.findByPk(vehicle_id);
    if (!vehicle) {
      return res.status(404).json({
        error: 'Vehicle not found',
        message: 'The requested vehicle does not exist'
      });
    }

    const anomalies = await VehicleLocation.detectAnomalies(
      vehicle_id,
      parseFloat(max_speed_kmh),
      parseFloat(max_jump_km)
    );

    res.json({
      vehicle_id,
      vehicle_info: {
        make: vehicle.make,
        model: vehicle.model,
        license_plate: vehicle.license_plate
      },
      anomalies,
      count: anomalies.length,
      parameters: {
        max_speed_kmh: parseFloat(max_speed_kmh),
        max_jump_km: parseFloat(max_jump_km)
      }
    });
  } catch (error) {
    logger.error('Detect anomalies error:', error);
    res.status(500).json({
      error: 'Failed to detect anomalies',
      message: 'Internal server error'
    });
  }
});

// Calculate distance between two points for a vehicle
router.get('/distance/:vehicle_id', auth, async (req, res) => {
  try {
    const { vehicle_id } = req.params;
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({
        error: 'Missing parameters',
        message: 'start_date and end_date are required'
      });
    }

    // Verify vehicle exists
    const vehicle = await Vehicle.findByPk(vehicle_id);
    if (!vehicle) {
      return res.status(404).json({
        error: 'Vehicle not found',
        message: 'The requested vehicle does not exist'
      });
    }

    // Check permissions for customers
    if (req.user.role === 'customer') {
      const Booking = require('../models/Booking');
      const userBookings = await Booking.findAll({
        where: {
          customer_id: req.user.id,
          vehicle_id: vehicle_id,
          status: ['confirmed', 'active', 'completed']
        }
      });

      if (userBookings.length === 0) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'You can only view distance for vehicles you have booked'
        });
      }
    }

    const startDate = new Date(start_date);
    const endDate = new Date(end_date);

    const distance = await VehicleLocation.calculateDistance(vehicle_id, startDate, endDate);

    res.json({
      vehicle_id,
      vehicle_info: {
        make: vehicle.make,
        model: vehicle.model,
        license_plate: vehicle.license_plate
      },
      distance_km: distance,
      period: {
        start_date: startDate,
        end_date: endDate
      }
    });
  } catch (error) {
    logger.error('Calculate distance error:', error);
    res.status(500).json({
      error: 'Failed to calculate distance',
      message: 'Internal server error'
    });
  }
});

module.exports = router;
