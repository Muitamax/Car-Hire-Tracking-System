const express = require('express');
const Joi = require('joi');
const { Vehicle, VehicleCategory, VehicleLocation, Booking } = require('../config/database').models;
const { auth, authorize } = require('../middleware/auth');
const { broadcastVehicleStatus } = require('../websocket/socketServer');
const logger = require('../utils/logger');

const router = express.Router();

// Validation schemas
const createVehicleSchema = Joi.object({
  make: Joi.string().min(1).max(100).required(),
  model: Joi.string().min(1).max(100).required(),
  year: Joi.number().integer().min(1900).max(new Date().getFullYear() + 1).required(),
  license_plate: Joi.string().min(1).max(20).required(),
  vin: Joi.string().min(11).max(50).optional(),
  category_id: Joi.number().integer().positive().required(),
  current_latitude: Joi.number().min(-90).max(90).optional(),
  current_longitude: Joi.number().min(-180).max(180).optional(),
  odometer: Joi.number().integer().min(0).optional(),
  fuel_level: Joi.number().min(0).max(100).optional(),
  last_maintenance: Joi.date().optional(),
  next_maintenance_due: Joi.date().optional()
});

const updateVehicleSchema = Joi.object({
  make: Joi.string().min(1).max(100).optional(),
  model: Joi.string().min(1).max(100).optional(),
  year: Joi.number().integer().min(1900).max(new Date().getFullYear() + 1).optional(),
  license_plate: Joi.string().min(1).max(20).optional(),
  vin: Joi.string().min(11).max(50).optional(),
  category_id: Joi.number().integer().positive().optional(),
  status: Joi.string().valid('available', 'booked', 'in_use', 'maintenance', 'offline').optional(),
  current_latitude: Joi.number().min(-90).max(90).optional(),
  current_longitude: Joi.number().min(-180).max(180).optional(),
  odometer: Joi.number().integer().min(0).optional(),
  fuel_level: Joi.number().min(0).max(100).optional(),
  last_maintenance: Joi.date().optional(),
  next_maintenance_due: Joi.date().optional(),
  is_active: Joi.boolean().optional()
});

// Get all vehicles
router.get('/', auth, async (req, res) => {
  try {
    const { status, category_id, page = 1, limit = 20, available_only = false } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = { is_active: true };
    
    if (status) {
      whereClause.status = status;
    }
    
    if (category_id) {
      whereClause.category_id = category_id;
    }

    if (available_only === 'true') {
      whereClause.status = 'available';
    }

    const vehicles = await Vehicle.findAndCountAll({
      where: whereClause,
      include: [{ model: VehicleCategory, as: 'category' }],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    // Get latest location for each vehicle
    const vehiclesWithLocations = await Promise.all(
      vehicles.rows.map(async (vehicle) => {
        const latestLocation = await VehicleLocation.getLatestByVehicle(vehicle.id);
        return {
          ...vehicle.toJSON(),
          latest_location: latestLocation ? {
            latitude: latestLocation.latitude,
            longitude: latestLocation.longitude,
            timestamp: latestLocation.timestamp,
            speed: latestLocation.speed,
            heading: latestLocation.heading
          } : null
        };
      })
    );

    res.json({
      vehicles: vehiclesWithLocations,
      pagination: {
        total: vehicles.count,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(vehicles.count / limit)
      }
    });
  } catch (error) {
    logger.error('Get vehicles error:', error);
    res.status(500).json({
      error: 'Failed to fetch vehicles',
      message: 'Internal server error'
    });
  }
});

// Get single vehicle
router.get('/:id', auth, async (req, res) => {
  try {
    const vehicle = await Vehicle.findByPk(req.params.id, {
      include: [{ model: VehicleCategory, as: 'category' }]
    });

    if (!vehicle || !vehicle.is_active) {
      return res.status(404).json({
        error: 'Vehicle not found',
        message: 'The requested vehicle does not exist'
      });
    }

    // Get latest location
    const latestLocation = await VehicleLocation.getLatestByVehicle(vehicle.id);

    // Get recent bookings
    const recentBookings = await Booking.findAll({
      where: { vehicle_id: vehicle.id },
      include: [{ model: require('../config/database').models.User, as: 'customer' }],
      order: [['created_at', 'DESC']],
      limit: 5
    });

    const vehicleData = {
      ...vehicle.toJSON(),
      latest_location: latestLocation ? {
        latitude: latestLocation.latitude,
        longitude: latestLocation.longitude,
        timestamp: latestLocation.timestamp,
        speed: latestLocation.speed,
        heading: latestLocation.heading
      } : null,
      recent_bookings: recentBookings
    };

    res.json({ vehicle: vehicleData });
  } catch (error) {
    logger.error('Get vehicle error:', error);
    res.status(500).json({
      error: 'Failed to fetch vehicle',
      message: 'Internal server error'
    });
  }
});

// Create new vehicle (admin only)
router.post('/', auth, authorize('admin'), async (req, res) => {
  try {
    const { error, value } = createVehicleSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.details.map(detail => detail.message)
      });
    }

    // Check if license plate already exists
    const existingVehicle = await Vehicle.findOne({
      where: { license_plate: value.license_plate }
    });

    if (existingVehicle) {
      return res.status(409).json({
        error: 'Vehicle already exists',
        message: 'License plate already registered'
      });
    }

    // Verify vehicle category exists
    const category = await VehicleCategory.findByPk(value.category_id);
    if (!category) {
      return res.status(400).json({
        error: 'Invalid category',
        message: 'Vehicle category does not exist'
      });
    }

    const vehicle = await Vehicle.create(value);

    const createdVehicle = await Vehicle.findByPk(vehicle.id, {
      include: [{ model: VehicleCategory, as: 'category' }]
    });

    logger.info(`Vehicle created: ${vehicle.id} (${vehicle.license_plate}) by ${req.user.email}`);

    res.status(201).json({
      message: 'Vehicle created successfully',
      vehicle: createdVehicle
    });
  } catch (error) {
    logger.error('Create vehicle error:', error);
    res.status(500).json({
      error: 'Failed to create vehicle',
      message: 'Internal server error'
    });
  }
});

// Update vehicle (admin only)
router.put('/:id', auth, authorize('admin'), async (req, res) => {
  try {
    const { error, value } = updateVehicleSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.details.map(detail => detail.message)
      });
    }

    const vehicle = await Vehicle.findByPk(req.params.id);
    if (!vehicle) {
      return res.status(404).json({
        error: 'Vehicle not found',
        message: 'The requested vehicle does not exist'
      });
    }

    const oldStatus = vehicle.status;

    // Update vehicle
    await vehicle.update(value);

    // If status changed, broadcast update
    if (value.status && value.status !== oldStatus) {
      broadcastVehicleStatus(vehicle.id, value.status);
    }

    const updatedVehicle = await Vehicle.findByPk(vehicle.id, {
      include: [{ model: VehicleCategory, as: 'category' }]
    });

    logger.info(`Vehicle updated: ${vehicle.id} by ${req.user.email}`);

    res.json({
      message: 'Vehicle updated successfully',
      vehicle: updatedVehicle
    });
  } catch (error) {
    logger.error('Update vehicle error:', error);
    res.status(500).json({
      error: 'Failed to update vehicle',
      message: 'Internal server error'
    });
  }
});

// Delete vehicle (soft delete, admin only)
router.delete('/:id', auth, authorize('admin'), async (req, res) => {
  try {
    const vehicle = await Vehicle.findByPk(req.params.id);
    if (!vehicle) {
      return res.status(404).json({
        error: 'Vehicle not found',
        message: 'The requested vehicle does not exist'
      });
    }

    // Check if vehicle has active bookings
    const activeBookings = await Booking.findAll({
      where: {
        vehicle_id: vehicle.id,
        status: ['confirmed', 'active']
      }
    });

    if (activeBookings.length > 0) {
      return res.status(400).json({
        error: 'Cannot delete vehicle',
        message: 'Vehicle has active bookings'
      });
    }

    // Soft delete
    vehicle.is_active = false;
    await vehicle.save();

    logger.info(`Vehicle deleted: ${vehicle.id} by ${req.user.email}`);

    res.json({
      message: 'Vehicle deleted successfully'
    });
  } catch (error) {
    logger.error('Delete vehicle error:', error);
    res.status(500).json({
      error: 'Failed to delete vehicle',
      message: 'Internal server error'
    });
  }
});

// Get vehicle location history
router.get('/:id/locations', auth, async (req, res) => {
  try {
    const { start_date, end_date, limit = 1000 } = req.query;
    const vehicle = await Vehicle.findByPk(req.params.id);

    if (!vehicle) {
      return res.status(404).json({
        error: 'Vehicle not found',
        message: 'The requested vehicle does not exist'
      });
    }

    // Check permissions (customers can only see their booked vehicles)
    if (req.user.role === 'customer') {
      const userBookings = await Booking.findAll({
        where: {
          customer_id: req.user.id,
          vehicle_id: vehicle.id,
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
      vehicle.id,
      startDate,
      endDate,
      parseInt(limit)
    );

    res.json({
      vehicle_id: vehicle.id,
      locations: locations.map(loc => ({
        latitude: loc.latitude,
        longitude: loc.longitude,
        speed: loc.speed,
        heading: loc.heading,
        timestamp: loc.timestamp
      })),
      count: locations.length
    });
  } catch (error) {
    logger.error('Get vehicle locations error:', error);
    res.status(500).json({
      error: 'Failed to fetch vehicle locations',
      message: 'Internal server error'
    });
  }
});

// Get vehicles in area
router.get('/nearby/vehicles', auth, async (req, res) => {
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

    const nearbyVehicles = await Vehicle.findInGeoFence(lat, lng, radius);

    // Get latest locations for these vehicles
    const vehiclesWithLocations = await Promise.all(
      nearbyVehicles.map(async (vehicle) => {
        const latestLocation = await VehicleLocation.getLatestByVehicle(vehicle.id);
        return {
          ...vehicle.toJSON(),
          latest_location: latestLocation ? {
            latitude: latestLocation.latitude,
            longitude: latestLocation.longitude,
            timestamp: latestLocation.timestamp,
            speed: latestLocation.speed,
            heading: latestLocation.heading
          } : null
        };
      })
    );

    res.json({
      center: { latitude: lat, longitude: lng },
      radius_km: radius,
      vehicles: vehiclesWithLocations,
      count: vehiclesWithLocations.length
    });
  } catch (error) {
    logger.error('Get nearby vehicles error:', error);
    res.status(500).json({
      error: 'Failed to fetch nearby vehicles',
      message: 'Internal server error'
    });
  }
});

// Get vehicle categories
router.get('/categories/all', auth, async (req, res) => {
  try {
    const categories = await VehicleCategory.findAll({
      order: [['name', 'ASC']]
    });

    res.json({ categories });
  } catch (error) {
    logger.error('Get categories error:', error);
    res.status(500).json({
      error: 'Failed to fetch categories',
      message: 'Internal server error'
    });
  }
});

module.exports = router;
