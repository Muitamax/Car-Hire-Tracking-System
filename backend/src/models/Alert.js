module.exports = (sequelize, DataTypes) => {
  const Alert = sequelize.define('Alert', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    vehicle_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'vehicles',
        key: 'id'
      }
    },
    alert_type: {
      type: DataTypes.ENUM(
        'geo_fence_violation', 
        'idle_timeout', 
        'maintenance_due', 
        'low_fuel', 
        'unauthorized_use', 
        'gps_error',
        'speed_violation',
        'location_anomaly'
      ),
      allowNull: false
    },
    severity: {
      type: DataTypes.ENUM('low', 'medium', 'high', 'critical'),
      allowNull: false,
      defaultValue: 'medium'
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    is_resolved: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    resolved_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    resolved_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    }
  }, {
    tableName: 'alerts',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false, // Only need creation timestamp
    indexes: [
      {
        fields: ['vehicle_id']
      },
      {
        fields: ['alert_type']
      },
      {
        fields: ['severity']
      },
      {
        fields: ['is_resolved']
      },
      {
        fields: ['created_at']
      },
      {
        fields: ['vehicle_id', 'is_resolved'],
        where: { is_resolved: false }
      }
    ]
  });

  // Instance methods
  Alert.prototype.resolve = async function(userId) {
    this.is_resolved = true;
    this.resolved_at = new Date();
    this.resolved_by = userId;
    await this.save();
    return this;
  };

  Alert.prototype.getSeverityLevel = function() {
    const levels = { low: 1, medium: 2, high: 3, critical: 4 };
    return levels[this.severity] || 0;
  };

  // Class methods
  Alert.findUnresolved = function(vehicleId = null, alertType = null) {
    const whereClause = { is_resolved: false };
    
    if (vehicleId) {
      whereClause.vehicle_id = vehicleId;
    }
    
    if (alertType) {
      whereClause.alert_type = alertType;
    }
    
    return this.findAll({
      where: whereClause,
      include: [
        { model: require('./Vehicle'), as: 'vehicle' },
        { model: require('./User'), as: 'resolver', attributes: ['id', 'first_name', 'last_name'] }
      ],
      order: [['created_at', 'DESC']]
    });
  };

  Alert.findBySeverity = function(severity) {
    return this.findAll({
      where: { 
        severity,
        is_resolved: false 
      },
      include: [{ model: require('./Vehicle'), as: 'vehicle' }],
      order: [['created_at', 'DESC']]
    });
  };

  Alert.getAlertStatistics = async function(days = 7) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const stats = await this.findAll({
      where: {
        created_at: {
          [sequelize.Sequelize.Op.gte]: startDate
        }
      },
      attributes: [
        [sequelize.fn('COUNT', sequelize.col('id')), 'total_alerts'],
        [sequelize.fn('COUNT', sequelize.literal('CASE WHEN is_resolved = false THEN 1 END')), 'unresolved_alerts'],
        [sequelize.fn('COUNT', sequelize.literal('CASE WHEN severity = \'critical\' THEN 1 END')), 'critical_alerts'],
        [sequelize.fn('COUNT', sequelize.literal('CASE WHEN severity = \'high\' THEN 1 END')), 'high_alerts']
      ],
      raw: true
    });

    return stats[0] || {
      total_alerts: 0,
      unresolved_alerts: 0,
      critical_alerts: 0,
      high_alerts: 0
    };
  };

  Alert.createAlert = async function(alertData) {
    const alert = await this.create(alertData);
    
    // Broadcast alert via WebSocket
    const { broadcastAlert } = require('../websocket/socketServer');
    broadcastAlert(alert);
    
    return alert;
  };

  return Alert;
};
