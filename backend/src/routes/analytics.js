const express = require('express');
const Joi = require('joi');
const { Booking, Trip, Vehicle, User, VehicleCategory, Payment } = require('../config/database').models;
const { auth, authorize } = require('../middleware/auth');
const { sequelize } = require('../config/database');
const logger = require('../utils/logger');

const router = express.Router();

// Validation schema for date range
const dateRangeSchema = Joi.object({
  start_date: Joi.date().iso().required(),
  end_date: Joi.date().iso().required(),
  vehicle_id: Joi.string().uuid().optional(),
  category_id: Joi.number().integer().optional()
});

// Get dashboard overview
router.get('/dashboard', auth, authorize('admin'), async (req, res) => {
  try {
    const { period = '30' } = req.query; // Default last 30 days
    const daysAgo = parseInt(period);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysAgo);

    // Get key metrics
    const [
      totalVehicles,
      activeVehicles,
      totalBookings,
      activeBookings,
      totalUsers,
      totalRevenue,
      completedTrips
    ] = await Promise.all([
      Vehicle.count({ where: { is_active: true } }),
      Vehicle.count({ where: { status: 'available', is_active: true } }),
      Booking.count({ where: { created_at: { [sequelize.Sequelize.Op.gte]: startDate } } }),
      Booking.count({ where: { status: 'active' } }),
      User.count({ where: { is_active: true } }),
      Payment.sum('amount', {
        where: {
          status: 'completed',
          created_at: { [sequelize.Sequelize.Op.gte]: startDate }
        }
      }),
      Trip.count({ 
        where: { 
          status: 'completed',
          end_time: { [sequelize.Sequelize.Op.gte]: startDate }
        }
      })
    ]);

    // Get vehicle status distribution
    const vehicleStatusCounts = await Vehicle.findAll({
      attributes: [
        'status',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      where: { is_active: true },
      group: ['status'],
      raw: true
    });

    // Get booking status distribution
    const bookingStatusCounts = await Booking.findAll({
      attributes: [
        'status',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      where: { created_at: { [sequelize.Sequelize.Op.gte]: startDate } },
      group: ['status'],
      raw: true
    });

    // Get revenue by day
    const dailyRevenue = await sequelize.query(`
      SELECT 
        DATE(created_at) as date,
        COALESCE(SUM(amount), 0) as revenue
      FROM payments
      WHERE status = 'completed' 
        AND created_at >= :startDate
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT 30
    `, {
      replacements: { startDate },
      type: sequelize.QueryTypes.SELECT
    });

    // Get most active vehicles
    const mostActiveVehicles = await Trip.getMostActiveVehicles(5, startDate, new Date());

    res.json({
      overview: {
        total_vehicles: totalVehicles || 0,
        available_vehicles: activeVehicles || 0,
        total_bookings: totalBookings || 0,
        active_bookings: activeBookings || 0,
        total_users: totalUsers || 0,
        total_revenue: totalRevenue || 0,
        completed_trips: completedTrips || 0
      },
      vehicle_status_distribution: vehicleStatusCounts,
      booking_status_distribution: bookingStatusCounts,
      daily_revenue: dailyRevenue,
      most_active_vehicles: mostActiveVehicles,
      period_days: daysAgo
    });
  } catch (error) {
    logger.error('Dashboard analytics error:', error);
    res.status(500).json({
      error: 'Failed to fetch dashboard analytics',
      message: 'Internal server error'
    });
  }
});

// Get revenue analytics
router.get('/revenue', auth, authorize('admin'), async (req, res) => {
  try {
    const { error, value } = dateRangeSchema.validate(req.query);
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.details.map(detail => detail.message)
      });
    }

    const { start_date, end_date, vehicle_id, category_id } = value;
    const startDate = new Date(start_date);
    const endDate = new Date(end_date);

    let whereClause = {
      status: 'completed',
      created_at: {
        [sequelize.Sequelize.Op.between]: [startDate, endDate]
      }
    };

    if (vehicle_id) {
      whereClause.vehicle_id = vehicle_id;
    }

    // Revenue by day
    const dailyRevenue = await sequelize.query(`
      SELECT 
        DATE(p.created_at) as date,
        COALESCE(SUM(p.amount), 0) as revenue,
        COUNT(p.id) as transaction_count
      FROM payments p
      JOIN bookings b ON p.booking_id = b.id
      ${vehicle_id ? 'WHERE b.vehicle_id = :vehicle_id AND' : 'WHERE'}
        p.status = 'completed' 
        AND p.created_at BETWEEN :startDate AND :endDate
      GROUP BY DATE(p.created_at)
      ORDER BY date
    `, {
      replacements: { vehicle_id, startDate, endDate },
      type: sequelize.QueryTypes.SELECT
    });

    // Revenue by vehicle category
    const categoryRevenue = await sequelize.query(`
      SELECT 
        vc.name as category_name,
        COALESCE(SUM(p.amount), 0) as revenue,
        COUNT(DISTINCT p.booking_id) as booking_count,
        COUNT(p.id) as payment_count
      FROM payments p
      JOIN bookings b ON p.booking_id = b.id
      JOIN vehicles v ON b.vehicle_id = v.id
      JOIN vehicle_categories vc ON v.category_id = vc.id
      WHERE p.status = 'completed' 
        AND p.created_at BETWEEN :startDate AND :endDate
        ${category_id ? 'AND v.category_id = :category_id' : ''}
      GROUP BY vc.id, vc.name
      ORDER BY revenue DESC
    `, {
      replacements: { category_id, startDate, endDate },
      type: sequelize.QueryTypes.SELECT
    });

    // Total metrics
    const totalMetrics = await Payment.findOne({
      attributes: [
        [sequelize.fn('SUM', sequelize.col('amount')), 'total_revenue'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'total_transactions'],
        [sequelize.fn('AVG', sequelize.col('amount')), 'avg_transaction']
      ],
      where: whereClause
    });

    res.json({
      period: {
        start_date: startDate,
        end_date: endDate
      },
      daily_revenue: dailyRevenue,
      category_revenue: categoryRevenue,
      total_metrics: totalMetrics || {
        total_revenue: 0,
        total_transactions: 0,
        avg_transaction: 0
      }
    });
  } catch (error) {
    logger.error('Revenue analytics error:', error);
    res.status(500).json({
      error: 'Failed to fetch revenue analytics',
      message: 'Internal server error'
    });
  }
});

// Get vehicle utilization analytics
router.get('/utilization', auth, authorize('admin'), async (req, res) => {
  try {
    const { error, value } = dateRangeSchema.validate(req.query);
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.details.map(detail => detail.message)
      });
    }

    const { start_date, end_date, vehicle_id, category_id } = value;
    const startDate = new Date(start_date);
    const endDate = new Date(end_date);

    // Vehicle utilization rates
    const utilizationQuery = `
      SELECT 
        v.id,
        v.make,
        v.model,
        v.license_plate,
        vc.name as category_name,
        COUNT(DISTINCT b.id) as booking_count,
        SUM(EXTRACT(EPOCH FROM (b.actual_return_datetime - b.actual_pickup_datetime))/3600) as total_hours,
        :total_period_hours as period_hours,
        CASE 
          WHEN :total_period_hours > 0 
          THEN (SUM(EXTRACT(EPOCH FROM (b.actual_return_datetime - b.actual_pickup_datetime))/3600) / :total_period_hours) * 100 
          ELSE 0 
        END as utilization_percentage
      FROM vehicles v
      LEFT JOIN bookings b ON v.id = b.vehicle_id 
        AND b.status = 'completed' 
        AND b.actual_pickup_datetime BETWEEN :startDate AND :endDate
      JOIN vehicle_categories vc ON v.category_id = vc.id
      WHERE v.is_active = true
        ${vehicle_id ? 'AND v.id = :vehicle_id' : ''}
        ${category_id ? 'AND v.category_id = :category_id' : ''}
      GROUP BY v.id, v.make, v.model, v.license_plate, vc.name
      ORDER BY utilization_percentage DESC
    `;

    const totalPeriodHours = (endDate - startDate) / (1000 * 60 * 60);
    
    const vehicleUtilization = await sequelize.query(utilizationQuery, {
      replacements: { 
        vehicle_id, 
        category_id, 
        startDate, 
        endDate, 
        total_period_hours: totalPeriodHours 
      },
      type: sequelize.QueryTypes.SELECT
    });

    // Category utilization
    const categoryUtilization = await sequelize.query(`
      SELECT 
        vc.name as category_name,
        COUNT(v.id) as total_vehicles,
        COUNT(DISTINCT b.id) as booking_count,
        AVG(
          CASE 
            WHEN :total_period_hours > 0 
            THEN (SUM(EXTRACT(EPOCH FROM (b.actual_return_datetime - b.actual_pickup_datetime))/3600) / :total_period_hours) * 100 
            ELSE 0 
          END
        ) as avg_utilization_percentage
      FROM vehicle_categories vc
      LEFT JOIN vehicles v ON vc.id = v.category_id AND v.is_active = true
      LEFT JOIN bookings b ON v.id = b.vehicle_id 
        AND b.status = 'completed' 
        AND b.actual_pickup_datetime BETWEEN :startDate AND :endDate
      ${category_id ? 'WHERE vc.id = :category_id' : ''}
      GROUP BY vc.id, vc.name
      ORDER BY avg_utilization_percentage DESC
    `, {
      replacements: { category_id, startDate, endDate, total_period_hours: totalPeriodHours },
      type: sequelize.QueryTypes.SELECT
    });

    res.json({
      period: {
        start_date: startDate,
        end_date: endDate,
        total_hours: totalPeriodHours
      },
      vehicle_utilization: vehicleUtilization,
      category_utilization: categoryUtilization
    });
  } catch (error) {
    logger.error('Utilization analytics error:', error);
    res.status(500).json({
      error: 'Failed to fetch utilization analytics',
      message: 'Internal server error'
    });
  }
});

// Get trip analytics
router.get('/trips', auth, authorize('admin'), async (req, res) => {
  try {
    const { error, value } = dateRangeSchema.validate(req.query);
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.details.map(detail => detail.message)
      });
    }

    const { start_date, end_date, vehicle_id } = value;
    const startDate = new Date(start_date);
    const endDate = new Date(end_date);

    // Trip statistics
    const tripStats = await Trip.getTripStatistics(vehicle_id, startDate, endDate);

    // Trips by day
    const dailyTrips = await Trip.findAll({
      attributes: [
        [sequelize.fn('DATE', sequelize.col('start_time')), 'date'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'trip_count'],
        [sequelize.fn('SUM', sequelize.col('distance_km')), 'total_distance'],
        [sequelize.fn('AVG', sequelize.col('distance_km')), 'avg_distance']
      ],
      where: {
        status: 'completed',
        start_time: {
          [sequelize.Sequelize.Op.between]: [startDate, endDate]
        },
        ...(vehicle_id && { vehicle_id })
      },
      group: [sequelize.fn('DATE', sequelize.col('start_time'))],
      order: [[sequelize.fn('DATE', sequelize.col('start_time')), 'ASC']]
    });

    // Most active vehicles
    const mostActiveVehicles = await Trip.getMostActiveVehicles(10, startDate, endDate);

    // Anomalous trips
    const anomalousTrips = await Trip.detectAnomalousTrips();

    res.json({
      period: {
        start_date: startDate,
        end_date: endDate
      },
      statistics: tripStats,
      daily_trips: dailyTrips,
      most_active_vehicles: mostActiveVehicles,
      anomalous_trips: anomalousTrips
    });
  } catch (error) {
    logger.error('Trip analytics error:', error);
    res.status(500).json({
      error: 'Failed to fetch trip analytics',
      message: 'Internal server error'
    });
  }
});

// Get customer analytics
router.get('/customers', auth, authorize('admin'), async (req, res) => {
  try {
    const { period = '90' } = req.query; // Default last 90 days
    const daysAgo = parseInt(period);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysAgo);

    // Customer registration trends
    const registrationTrends = await sequelize.query(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as new_customers
      FROM users
      WHERE role = 'customer' 
        AND created_at >= :startDate
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT 30
    `, {
      replacements: { startDate },
      type: sequelize.QueryTypes.SELECT
    });

    // Top customers by bookings
    const topCustomers = await sequelize.query(`
      SELECT 
        u.id,
        u.first_name,
        u.last_name,
        u.email,
        COUNT(b.id) as booking_count,
        COALESCE(SUM(b.total_cost), 0) as total_spent,
        AVG(b.total_cost) as avg_booking_cost
      FROM users u
      LEFT JOIN bookings b ON u.id = b.customer_id 
        AND b.status = 'completed'
      WHERE u.role = 'customer' AND u.is_active = true
      GROUP BY u.id, u.first_name, u.last_name, u.email
      HAVING COUNT(b.id) > 0
      ORDER BY booking_count DESC
      LIMIT 20
    `, {
      type: sequelize.QueryTypes.SELECT
    });

    // Customer activity summary
    const activitySummary = await sequelize.query(`
      SELECT 
        COUNT(DISTINCT u.id) as total_customers,
        COUNT(DISTINCT CASE WHEN b.created_at >= :startDate THEN u.id END) as active_customers,
        COUNT(DISTINCT CASE WHEN b.status = 'active' THEN u.id END) as customers_with_active_bookings,
        COUNT(DISTINCT CASE WHEN b.created_at >= :startDate AND b.status = 'completed' THEN u.id END) as customers_with_completed_bookings
      FROM users u
      LEFT JOIN bookings b ON u.id = b.customer_id
      WHERE u.role = 'customer' AND u.is_active = true
    `, {
      replacements: { startDate },
      type: sequelize.QueryTypes.SELECT
    });

    res.json({
      period_days: daysAgo,
      registration_trends: registrationTrends,
      top_customers: topCustomers,
      activity_summary: activitySummary[0] || {
        total_customers: 0,
        active_customers: 0,
        customers_with_active_bookings: 0,
        customers_with_completed_bookings: 0
      }
    });
  } catch (error) {
    logger.error('Customer analytics error:', error);
    res.status(500).json({
      error: 'Failed to fetch customer analytics',
      message: 'Internal server error'
    });
  }
});

module.exports = router;
