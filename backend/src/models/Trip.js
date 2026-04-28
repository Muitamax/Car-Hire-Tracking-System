module.exports = (sequelize, DataTypes) => {
  const Trip = sequelize.define('Trip', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    booking_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'bookings',
        key: 'id'
      }
    },
    vehicle_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'vehicles',
        key: 'id'
      }
    },
    driver_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    start_time: {
      type: DataTypes.DATE,
      allowNull: false
    },
    end_time: {
      type: DataTypes.DATE,
      allowNull: true
    },
    start_latitude: {
      type: DataTypes.DECIMAL(10, 8),
      allowNull: true,
      validate: {
        min: -90,
        max: 90
      }
    },
    start_longitude: {
      type: DataTypes.DECIMAL(11, 8),
      allowNull: true,
      validate: {
        min: -180,
        max: 180
      }
    },
    end_latitude: {
      type: DataTypes.DECIMAL(10, 8),
      allowNull: true,
      validate: {
        min: -90,
        max: 90
      }
    },
    end_longitude: {
      type: DataTypes.DECIMAL(11, 8),
      allowNull: true,
      validate: {
        min: -180,
        max: 180
      }
    },
    start_odometer: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: {
        min: 0
      }
    },
    end_odometer: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: {
        min: 0
      }
    },
    distance_km: {
      type: DataTypes.DECIMAL(8, 2),
      allowNull: true,
      validate: {
        min: 0
      }
    },
    duration_minutes: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: {
        min: 0
      }
    },
    base_cost: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      validate: {
        min: 0
      }
    },
    distance_cost: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      validate: {
        min: 0
      }
    },
    time_cost: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      validate: {
        min: 0
      }
    },
    total_cost: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      validate: {
        min: 0
      }
    },
    status: {
      type: DataTypes.ENUM('active', 'completed', 'cancelled'),
      allowNull: false,
      defaultValue: 'active'
    }
  }, {
    tableName: 'trips',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        fields: ['booking_id']
      },
      {
        fields: ['vehicle_id']
      },
      {
        fields: ['driver_id']
      },
      {
        fields: ['status']
      },
      {
        fields: ['start_time']
      },
      {
        fields: ['vehicle_id', 'start_time']
      }
    ]
  });

  // Instance methods
  Trip.prototype.endTrip = async function(endLatitude, endLongitude, endOdometer) {
    const VehicleLocation = require('./VehicleLocation');
    
    this.end_time = new Date();
    this.end_latitude = endLatitude;
    this.end_longitude = endLongitude;
    this.end_odometer = endOdometer || this.start_odometer;
    this.status = 'completed';

    // Calculate duration
    const durationMs = this.end_time - this.start_time;
    this.duration_minutes = Math.round(durationMs / (1000 * 60));

    // Calculate distance using location history
    this.distance_km = await VehicleLocation.calculateDistance(
      this.vehicle_id,
      this.start_time,
      this.end_time
    );

    // Update odometer difference
    if (this.start_odometer && this.end_odometer) {
      const odometerDistance = this.end_odometer - this.start_odometer;
      // Use GPS distance if odometer seems unreasonable
      if (this.distance_km && Math.abs(odometerDistance - this.distance_km) > this.distance_km * 0.5) {
        // GPS distance is more reliable, keep it
      } else if (odometerDistance > 0) {
        this.distance_km = odometerDistance / 1000; // Convert to km
      }
    }

    await this.save();
    
    // Calculate cost using database function
    const sequelize = require('../config/database').sequelize;
    await sequelize.query(
      'SELECT calculate_trip_cost(:trip_id)',
      {
        replacements: { trip_id: this.id },
        type: sequelize.QueryTypes.SELECT
      }
    );

    // Reload to get calculated costs
    await this.reload();
    
    return this;
  };

  Trip.prototype.cancelTrip = async function() {
    this.end_time = new Date();
    this.status = 'cancelled';
    await this.save();
    return this;
  };

  Trip.prototype.isActive = function() {
    return this.status === 'active';
  };

  Trip.prototype.isCompleted = function() {
    return this.status === 'completed';
  };

  Trip.prototype.getDurationHours = function() {
    if (!this.duration_minutes) return 0;
    return this.duration_minutes / 60;
  };

  Trip.prototype.getAverageSpeed = function() {
    if (!this.distance_km || !this.duration_minutes) return 0;
    const hours = this.duration_minutes / 60;
    return hours > 0 ? this.distance_km / hours : 0;
  };

  // Class methods
  Trip.findActiveTrips = function() {
    return this.findAll({
      where: { status: 'active' },
      include: [
        { model: require('./Booking'), as: 'booking' },
        { model: require('./Vehicle'), as: 'vehicle' },
        { model: require('./User'), as: 'driver' }
      ]
    });
  };

  Trip.findByVehicle = function(vehicleId, startDate, endDate) {
    const whereClause = { vehicle_id: vehicleId };
    
    if (startDate && endDate) {
      whereClause.start_time = {
        [sequelize.Sequelize.Op.between]: [startDate, endDate]
      };
    }
    
    return this.findAll({
      where: whereClause,
      include: ['driver', 'booking'],
      order: [['start_time', 'DESC']]
    });
  };

  Trip.findByDriver = function(driverId, status = null) {
    const whereClause = { driver_id: driverId };
    
    if (status) {
      whereClause.status = status;
    }
    
    return this.findAll({
      where: whereClause,
      include: ['vehicle', 'booking'],
      order: [['start_time', 'DESC']]
    });
  };

  Trip.getTripStatistics = async function(vehicleId = null, startDate = null, endDate = null) {
    const whereClause = { status: 'completed' };
    
    if (vehicleId) {
      whereClause.vehicle_id = vehicleId;
    }
    
    if (startDate && endDate) {
      whereClause.start_time = {
        [sequelize.Sequelize.Op.between]: [startDate, endDate]
      };
    }

    const stats = await this.findAll({
      where: whereClause,
      attributes: [
        [sequelize.fn('COUNT', sequelize.col('id')), 'total_trips'],
        [sequelize.fn('SUM', sequelize.col('distance_km')), 'total_distance'],
        [sequelize.fn('SUM', sequelize.col('duration_minutes')), 'total_duration'],
        [sequelize.fn('SUM', sequelize.col('total_cost')), 'total_revenue'],
        [sequelize.fn('AVG', sequelize.col('distance_km')), 'avg_distance'],
        [sequelize.fn('AVG', sequelize.col('duration_minutes')), 'avg_duration'],
        [sequelize.fn('AVG', sequelize.col('total_cost')), 'avg_cost']
      ],
      raw: true
    });

    return stats[0] || {
      total_trips: 0,
      total_distance: 0,
      total_duration: 0,
      total_revenue: 0,
      avg_distance: 0,
      avg_duration: 0,
      avg_cost: 0
    };
  };

  Trip.getMostActiveVehicles = async function(limit = 10, startDate = null, endDate = null) {
    const whereClause = { status: 'completed' };
    
    if (startDate && endDate) {
      whereClause.start_time = {
        [sequelize.Sequelize.Op.between]: [startDate, endDate]
      };
    }

    return await this.findAll({
      where: whereClause,
      attributes: [
        'vehicle_id',
        [sequelize.fn('COUNT', sequelize.col('id')), 'trip_count'],
        [sequelize.fn('SUM', sequelize.col('distance_km')), 'total_distance'],
        [sequelize.fn('SUM', sequelize.col('total_cost')), 'total_revenue']
      ],
      include: [
        {
          model: require('./Vehicle'),
          as: 'vehicle',
          attributes: ['id', 'make', 'model', 'license_plate']
        }
      ],
      group: ['vehicle_id', 'vehicle.id'],
      order: [[sequelize.fn('COUNT', sequelize.col('id')), 'DESC']],
      limit
    });
  };

  Trip.detectAnomalousTrips = async function(maxSpeedKmh = 150, maxDurationHours = 24) {
    const anomalousTrips = await this.findAll({
      where: {
        status: 'completed',
        [sequelize.Sequelize.Op.or]: [
          {
            duration_minutes: {
              [sequelize.Sequelize.Op.gt]: maxDurationHours * 60
            }
          },
          sequelize.where(
            sequelize.literal('(distance_km / NULLIF(duration_minutes, 0) * 60)'),
            { [sequelize.Sequelize.Op.gt]: maxSpeedKmh }
          )
        ]
      },
      include: ['vehicle', 'driver', 'booking']
    });

    return anomalousTrips.map(trip => {
      const avgSpeed = trip.getAverageSpeed();
      const anomalies = [];
      
      if (trip.duration_minutes > maxDurationHours * 60) {
        anomalies.push({
          type: 'long_duration',
          value: trip.duration_minutes,
          message: `Trip duration ${trip.duration_minutes} minutes exceeds maximum ${maxDurationHours * 60} minutes`
        });
      }
      
      if (avgSpeed > maxSpeedKmh) {
        anomalies.push({
          type: 'high_speed',
          value: avgSpeed,
          message: `Average speed ${avgSpeed.toFixed(2)} km/h exceeds maximum ${maxSpeedKmh} km/h`
        });
      }
      
      return {
        trip: trip,
        anomalies: anomalies
      };
    });
  };

  return Trip;
};
