const express = require('express');
const Joi = require('joi');
const { Booking, Vehicle, User, VehicleCategory } = require('../config/database').models;
const { auth, authorize } = require('../middleware/auth');
const { broadcastBookingUpdate } = require('../websocket/socketServer');
const logger = require('../utils/logger');

const router = express.Router();

// Validation schemas
const createBookingSchema = Joi.object({
  vehicle_id: Joi.string().uuid().required(),
  pickup_datetime: Joi.date().iso().required(),
  return_datetime: Joi.date().iso().required(),
  pickup_location: Joi.string().optional(),
  dropoff_location: Joi.string().optional(),
  notes: Joi.string().optional()
});

const updateBookingSchema = Joi.object({
  pickup_datetime: Joi.date().iso().optional(),
  return_datetime: Joi.date().iso().optional(),
  pickup_location: Joi.string().optional(),
  dropoff_location: Joi.string().optional(),
  notes: Joi.string().optional()
});

// Get all bookings (admin only or customer's own bookings)
router.get('/', auth, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = {};
    
    if (req.user.role === 'customer') {
      whereClause.customer_id = req.user.id;
    }
    
    if (status) {
      whereClause.status = status;
    }

    const bookings = await Booking.findAndCountAll({
      where: whereClause,
      include: [
        { model: Vehicle, as: 'vehicle', include: [{ model: VehicleCategory, as: 'category' }] },
        { model: User, as: 'customer', attributes: ['id', 'first_name', 'last_name', 'email'] }
      ],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({
      bookings: bookings.rows,
      pagination: {
        total: bookings.count,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(bookings.count / limit)
      }
    });
  } catch (error) {
    logger.error('Get bookings error:', error);
    res.status(500).json({
      error: 'Failed to fetch bookings',
      message: 'Internal server error'
    });
  }
});

// Get single booking
router.get('/:id', auth, async (req, res) => {
  try {
    const booking = await Booking.findByPk(req.params.id, {
      include: [
        { model: Vehicle, as: 'vehicle', include: [{ model: VehicleCategory, as: 'category' }] },
        { model: User, as: 'customer' }
      ]
    });

    if (!booking) {
      return res.status(404).json({
        error: 'Booking not found',
        message: 'The requested booking does not exist'
      });
    }

    // Check permissions
    if (req.user.role === 'customer' && booking.customer_id !== req.user.id) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You can only view your own bookings'
      });
    }

    res.json({ booking });
  } catch (error) {
    logger.error('Get booking error:', error);
    res.status(500).json({
      error: 'Failed to fetch booking',
      message: 'Internal server error'
    });
  }
});

// Create new booking
router.post('/', auth, authorize('customer', 'admin'), async (req, res) => {
  try {
    const { error, value } = createBookingSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.details.map(detail => detail.message)
      });
    }

    const { vehicle_id, pickup_datetime, return_datetime, pickup_location, dropoff_location, notes } = value;

    // Verify vehicle exists and is available
    const vehicle = await Vehicle.findByPk(vehicle_id);
    if (!vehicle || !vehicle.is_active) {
      return res.status(404).json({
        error: 'Vehicle not available',
        message: 'The requested vehicle is not available'
      });
    }

    // Check for overlapping bookings (concurrency control)
    const overlappingBookings = await Booking.findOverlappingBookings(
      vehicle_id,
      new Date(pickup_datetime),
      new Date(return_datetime)
    );

    if (overlappingBookings.length > 0) {
      return res.status(409).json({
        error: 'Booking conflict',
        message: 'Vehicle is already booked for the requested time period'
      });
    }

    // Create booking
    const booking = await Booking.create({
      customer_id: req.user.id,
      vehicle_id,
      pickup_datetime: new Date(pickup_datetime),
      return_datetime: new Date(return_datetime),
      pickup_location,
      dropoff_location,
      notes
    });

    // Calculate initial cost
    await booking.calculateCost();

    // Get complete booking with associations
    const completeBooking = await Booking.findByPk(booking.id, {
      include: [
        { model: Vehicle, as: 'vehicle', include: [{ model: VehicleCategory, as: 'category' }] },
        { model: User, as: 'customer' }
      ]
    });

    // Update vehicle status
    await vehicle.updateStatus('booked');

    // Broadcast update
    broadcastBookingUpdate(completeBooking);

    logger.info(`Booking created: ${booking.id} by ${req.user.email}`);

    res.status(201).json({
      message: 'Booking created successfully',
      booking: completeBooking
    });
  } catch (error) {
    logger.error('Create booking error:', error);
    res.status(500).json({
      error: 'Failed to create booking',
      message: 'Internal server error'
    });
  }
});

// Update booking
router.put('/:id', auth, async (req, res) => {
  try {
    const { error, value } = updateBookingSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.details.map(detail => detail.message)
      });
    }

    const booking = await Booking.findByPk(req.params.id);
    if (!booking) {
      return res.status(404).json({
        error: 'Booking not found',
        message: 'The requested booking does not exist'
      });
    }

    // Check permissions
    if (req.user.role === 'customer' && booking.customer_id !== req.user.id) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You can only update your own bookings'
      });
    }

    // Don't allow updates to confirmed or active bookings
    if (['confirmed', 'active'].includes(booking.status)) {
      return res.status(400).json({
        error: 'Update not allowed',
        message: 'Cannot update bookings that are confirmed or active'
      });
    }

    const { pickup_datetime, return_datetime, pickup_location, dropoff_location, notes } = value;

    // Check for overlapping bookings if dates are being updated
    if (pickup_datetime || return_datetime) {
      const newPickupDate = pickup_datetime ? new Date(pickup_datetime) : booking.pickup_datetime;
      const newReturnDate = return_datetime ? new Date(return_datetime) : booking.return_datetime;

      const overlappingBookings = await Booking.findOverlappingBookings(
        booking.vehicle_id,
        newPickupDate,
        newReturnDate,
        booking.id // Exclude current booking
      );

      if (overlappingBookings.length > 0) {
        return res.status(409).json({
          error: 'Booking conflict',
          message: 'Vehicle is already booked for the requested time period'
        });
      }

      booking.pickup_datetime = newPickupDate;
      booking.return_datetime = newReturnDate;
    }

    // Update other fields
    if (pickup_location !== undefined) booking.pickup_location = pickup_location;
    if (dropoff_location !== undefined) booking.dropoff_location = dropoff_location;
    if (notes !== undefined) booking.notes = notes;

    await booking.save();

    // Recalculate cost if dates changed
    if (pickup_datetime || return_datetime) {
      await booking.calculateCost();
    }

    // Get updated booking with associations
    const updatedBooking = await Booking.findByPk(booking.id, {
      include: [
        { model: Vehicle, as: 'vehicle', include: [{ model: VehicleCategory, as: 'category' }] },
        { model: User, as: 'customer' }
      ]
    });

    // Broadcast update
    broadcastBookingUpdate(updatedBooking);

    logger.info(`Booking updated: ${booking.id} by ${req.user.email}`);

    res.json({
      message: 'Booking updated successfully',
      booking: updatedBooking
    });
  } catch (error) {
    logger.error('Update booking error:', error);
    res.status(500).json({
      error: 'Failed to update booking',
      message: 'Internal server error'
    });
  }
});

// Confirm booking
router.post('/:id/confirm', auth, authorize('admin'), async (req, res) => {
  try {
    const booking = await Booking.findByPk(req.params.id);
    if (!booking) {
      return res.status(404).json({
        error: 'Booking not found',
        message: 'The requested booking does not exist'
      });
    }

    if (booking.status !== 'pending') {
      return res.status(400).json({
        error: 'Invalid status',
        message: 'Only pending bookings can be confirmed'
      });
    }

    await booking.updateStatus('confirmed');

    // Get updated booking with associations
    const updatedBooking = await Booking.findByPk(booking.id, {
      include: [
        { model: Vehicle, as: 'vehicle', include: [{ model: VehicleCategory, as: 'category' }] },
        { model: User, as: 'customer' }
      ]
    });

    // Broadcast update
    broadcastBookingUpdate(updatedBooking);

    logger.info(`Booking confirmed: ${booking.id} by ${req.user.email}`);

    res.json({
      message: 'Booking confirmed successfully',
      booking: updatedBooking
    });
  } catch (error) {
    logger.error('Confirm booking error:', error);
    res.status(500).json({
      error: 'Failed to confirm booking',
      message: 'Internal server error'
    });
  }
});

// Cancel booking
router.post('/:id/cancel', auth, async (req, res) => {
  try {
    const booking = await Booking.findByPk(req.params.id);
    if (!booking) {
      return res.status(404).json({
        error: 'Booking not found',
        message: 'The requested booking does not exist'
      });
    }

    // Check permissions
    if (req.user.role === 'customer' && booking.customer_id !== req.user.id) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You can only cancel your own bookings'
      });
    }

    if (['completed', 'cancelled'].includes(booking.status)) {
      return res.status(400).json({
        error: 'Invalid status',
        message: 'Cannot cancel completed or already cancelled bookings'
      });
    }

    await booking.updateStatus('cancelled');

    // Get updated booking with associations
    const updatedBooking = await Booking.findByPk(booking.id, {
      include: [
        { model: Vehicle, as: 'vehicle', include: [{ model: VehicleCategory, as: 'category' }] },
        { model: User, as: 'customer' }
      ]
    });

    // Broadcast update
    broadcastBookingUpdate(updatedBooking);

    logger.info(`Booking cancelled: ${booking.id} by ${req.user.email}`);

    res.json({
      message: 'Booking cancelled successfully',
      booking: updatedBooking
    });
  } catch (error) {
    logger.error('Cancel booking error:', error);
    res.status(500).json({
      error: 'Failed to cancel booking',
      message: 'Internal server error'
    });
  }
});

// Get booking availability for vehicle
router.get('/availability/:vehicle_id', auth, async (req, res) => {
  try {
    const { vehicle_id } = req.params;
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({
        error: 'Missing parameters',
        message: 'start_date and end_date are required'
      });
    }

    const startDate = new Date(start_date);
    const endDate = new Date(end_date);

    if (startDate >= endDate) {
      return res.status(400).json({
        error: 'Invalid date range',
        message: 'start_date must be before end_date'
      });
    }

    // Check vehicle availability
    const vehicle = await Vehicle.findByPk(vehicle_id);
    if (!vehicle || !vehicle.is_active) {
      return res.status(404).json({
        error: 'Vehicle not available',
        message: 'The requested vehicle is not available'
      });
    }

    // Check for overlapping bookings
    const overlappingBookings = await Booking.findOverlappingBookings(
      vehicle_id,
      startDate,
      endDate
    );

    res.json({
      vehicle_id,
      start_date: startDate,
      end_date: endDate,
      is_available: overlappingBookings.length === 0,
      conflicting_bookings: overlappingBookings.map(booking => ({
        id: booking.id,
        pickup_datetime: booking.pickup_datetime,
        return_datetime: booking.return_datetime
      }))
    });
  } catch (error) {
    logger.error('Check availability error:', error);
    res.status(500).json({
      error: 'Failed to check availability',
      message: 'Internal server error'
    });
  }
});

module.exports = router;
