const express = require('express');
const Joi = require('joi');
const { Alert, Vehicle, User } = require('../config/database').models;
const { auth, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Get all alerts
router.get('/', auth, authorize('admin'), async (req, res) => {
  try {
    const { alert_type, severity, is_resolved, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = {};
    
    if (alert_type) {
      whereClause.alert_type = alert_type;
    }
    
    if (severity) {
      whereClause.severity = severity;
    }
    
    if (is_resolved !== undefined) {
      whereClause.is_resolved = is_resolved === 'true';
    }

    const alerts = await Alert.findAndCountAll({
      where: whereClause,
      include: [
        { model: Vehicle, as: 'vehicle', attributes: ['id', 'make', 'model', 'license_plate'] },
        { model: User, as: 'resolver', attributes: ['id', 'first_name', 'last_name'] }
      ],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({
      alerts: alerts.rows,
      pagination: {
        total: alerts.count,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(alerts.count / limit)
      }
    });
  } catch (error) {
    logger.error('Get alerts error:', error);
    res.status(500).json({
      error: 'Failed to fetch alerts',
      message: 'Internal server error'
    });
  }
});

// Get unresolved alerts
router.get('/unresolved', auth, authorize('admin'), async (req, res) => {
  try {
    const { vehicle_id, alert_type } = req.query;
    
    const alerts = await Alert.findUnresolved(vehicle_id, alert_type);

    res.json({
      alerts,
      count: alerts.length
    });
  } catch (error) {
    logger.error('Get unresolved alerts error:', error);
    res.status(500).json({
      error: 'Failed to fetch unresolved alerts',
      message: 'Internal server error'
    });
  }
});

// Create new alert
router.post('/', auth, authorize('admin'), async (req, res) => {
  try {
    const createAlertSchema = Joi.object({
      vehicle_id: Joi.string().uuid().optional(),
      alert_type: Joi.string().valid(
        'geo_fence_violation', 
        'idle_timeout', 
        'maintenance_due', 
        'low_fuel', 
        'unauthorized_use', 
        'gps_error',
        'speed_violation',
        'location_anomaly'
      ).required(),
      severity: Joi.string().valid('low', 'medium', 'high', 'critical').required(),
      message: Joi.string().required()
    });

    const { error, value } = createAlertSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.details.map(detail => detail.message)
      });
    }

    // Verify vehicle exists if provided
    if (value.vehicle_id) {
      const vehicle = await Vehicle.findByPk(value.vehicle_id);
      if (!vehicle) {
        return res.status(404).json({
          error: 'Vehicle not found',
          message: 'The specified vehicle does not exist'
        });
      }
    }

    const alert = await Alert.createAlert(value);

    const createdAlert = await Alert.findByPk(alert.id, {
      include: [
        { model: Vehicle, as: 'vehicle' },
        { model: User, as: 'resolver', attributes: ['id', 'first_name', 'last_name'] }
      ]
    });

    logger.info(`Alert created: ${alert.id} (${alert.alert_type}) by ${req.user.email}`);

    res.status(201).json({
      message: 'Alert created successfully',
      alert: createdAlert
    });
  } catch (error) {
    logger.error('Create alert error:', error);
    res.status(500).json({
      error: 'Failed to create alert',
      message: 'Internal server error'
    });
  }
});

// Resolve alert
router.post('/:id/resolve', auth, authorize('admin'), async (req, res) => {
  try {
    const alert = await Alert.findByPk(req.params.id);
    if (!alert) {
      return res.status(404).json({
        error: 'Alert not found',
        message: 'The requested alert does not exist'
      });
    }

    if (alert.is_resolved) {
      return res.status(400).json({
        error: 'Alert already resolved',
        message: 'This alert has already been resolved'
      });
    }

    await alert.resolve(req.user.id);

    const resolvedAlert = await Alert.findByPk(alert.id, {
      include: [
        { model: Vehicle, as: 'vehicle' },
        { model: User, as: 'resolver', attributes: ['id', 'first_name', 'last_name'] }
      ]
    });

    logger.info(`Alert resolved: ${alert.id} by ${req.user.email}`);

    res.json({
      message: 'Alert resolved successfully',
      alert: resolvedAlert
    });
  } catch (error) {
    logger.error('Resolve alert error:', error);
    res.status(500).json({
      error: 'Failed to resolve alert',
      message: 'Internal server error'
    });
  }
});

// Get alert statistics
router.get('/statistics/summary', auth, authorize('admin'), async (req, res) => {
  try {
    const { days = 7 } = req.query;
    
    const stats = await Alert.getAlertStatistics(parseInt(days));

    // Get alerts by type
    const alertsByType = await Alert.findAll({
      attributes: [
        'alert_type',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      where: {
        created_at: {
          [sequelize.Sequelize.Op.gte]: new Date(Date.now() - days * 24 * 60 * 60 * 1000)
        }
      },
      group: ['alert_type'],
      order: [[sequelize.fn('COUNT', sequelize.col('id')), 'DESC']]
    });

    // Get alerts by severity
    const alertsBySeverity = await Alert.findAll({
      attributes: [
        'severity',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      where: {
        created_at: {
          [sequelize.Sequelize.Op.gte]: new Date(Date.now() - days * 24 * 60 * 60 * 1000)
        }
      },
      group: ['severity'],
      order: [[sequelize.fn('COUNT', sequelize.col('id')), 'DESC']]
    });

    res.json({
      period_days: parseInt(days),
      summary: stats,
      by_type: alertsByType,
      by_severity: alertsBySeverity
    });
  } catch (error) {
    logger.error('Get alert statistics error:', error);
    res.status(500).json({
      error: 'Failed to fetch alert statistics',
      message: 'Internal server error'
    });
  }
});

module.exports = router;
