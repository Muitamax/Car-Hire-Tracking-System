module.exports = (sequelize, DataTypes) => {
  const VehicleLocation = sequelize.define('VehicleLocation', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    vehicle_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'vehicles',
        key: 'id'
      }
    },
    latitude: {
      type: DataTypes.DECIMAL(10, 8),
      allowNull: false,
      validate: {
        min: -90,
        max: 90
      }
    },
    longitude: {
      type: DataTypes.DECIMAL(11, 8),
      allowNull: false,
      validate: {
        min: -180,
        max: 180
      }
    },
    speed: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      validate: {
        min: 0,
        max: 500 // Reasonable max speed in km/h
      }
    },
    heading: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      validate: {
        min: 0,
        max: 360
      }
    },
    timestamp: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'vehicle_locations',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false, // Only need creation timestamp
    indexes: [
      {
        fields: ['vehicle_id']
      },
      {
        fields: ['timestamp']
      },
      {
        fields: ['vehicle_id', 'timestamp']
      },
      {
        fields: ['vehicle_id', 'timestamp', 'latitude', 'longitude']
      }
    ]
  });

  // Instance methods
  VehicleLocation.prototype.getCoordinates = function() {
    return {
      latitude: parseFloat(this.latitude),
      longitude: parseFloat(this.longitude)
    };
  };

  VehicleLocation.prototype.getSpeedKmh = function() {
    return this.speed ? parseFloat(this.speed) : 0;
  };

  VehicleLocation.prototype.getHeadingDegrees = function() {
    return this.heading ? parseFloat(this.heading) : 0;
  };

  // Class methods
  VehicleLocation.getLatestByVehicle = async function(vehicleId) {
    return await this.findOne({
      where: { vehicle_id: vehicleId },
      order: [['timestamp', 'DESC']]
    });
  };

  VehicleLocation.getHistoryByVehicle = async function(vehicleId, startDate, endDate, limit = 1000) {
    const whereClause = { vehicle_id: vehicleId };
    
    if (startDate && endDate) {
      whereClause.timestamp = {
        [sequelize.Sequelize.Op.between]: [startDate, endDate]
      };
    }
    
    return await this.findAll({
      where: whereClause,
      order: [['timestamp', 'ASC']],
      limit
    });
  };

  VehicleLocation.getRecentByVehicle = async function(vehicleId, minutes = 60) {
    const startTime = new Date(Date.now() - minutes * 60 * 1000);
    
    return await this.findAll({
      where: {
        vehicle_id: vehicleId,
        timestamp: {
          [sequelize.Sequelize.Op.gte]: startTime
        }
      },
      order: [['timestamp', 'DESC']],
      limit: 100
    });
  };

  VehicleLocation.getAllLatest = async function() {
    // Get the latest location for each vehicle
    const query = `
      SELECT DISTINCT ON (vehicle_id) *
      FROM vehicle_locations
      ORDER BY vehicle_id, timestamp DESC
    `;
    
    return await sequelize.query(query, {
      type: sequelize.QueryTypes.SELECT,
      model: this
    });
  };

  VehicleLocation.getVehiclesInArea = async function(centerLat, centerLng, radiusKm = 1) {
    // This would use PostGIS for accurate geo queries
    // For now, use approximate bounding box
    const latDelta = radiusKm / 111; // Approximate km to degrees
    const lngDelta = radiusKm / (111 * Math.cos(centerLat * Math.PI / 180));
    
    const query = `
      SELECT DISTINCT ON (vehicle_id) vehicle_id, latitude, longitude, timestamp
      FROM vehicle_locations
      WHERE latitude BETWEEN :minLat AND :maxLat
        AND longitude BETWEEN :minLng AND :maxLng
        AND timestamp >= :timeThreshold
      ORDER BY vehicle_id, timestamp DESC
    `;
    
    return await sequelize.query(query, {
      replacements: {
        minLat: centerLat - latDelta,
        maxLat: centerLat + latDelta,
        minLng: centerLng - lngDelta,
        maxLng: centerLng + lngDelta,
        timeThreshold: new Date(Date.now() - 5 * 60 * 1000) // Last 5 minutes
      },
      type: sequelize.QueryTypes.SELECT,
      model: this
    });
  };

  VehicleLocation.calculateDistance = async function(vehicleId, startTime, endTime) {
    const locations = await this.findAll({
      where: {
        vehicle_id: vehicleId,
        timestamp: {
          [sequelize.Sequelize.Op.between]: [startTime, endTime]
        }
      },
      order: [['timestamp', 'ASC']]
    });

    if (locations.length < 2) return 0;

    let totalDistance = 0;
    for (let i = 1; i < locations.length; i++) {
      const prev = locations[i - 1];
      const curr = locations[i];
      
      // Haversine formula for distance calculation
      const R = 6371; // Earth's radius in km
      const dLat = (curr.latitude - prev.latitude) * Math.PI / 180;
      const dLon = (curr.longitude - prev.longitude) * Math.PI / 180;
      const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(prev.latitude * Math.PI / 180) * Math.cos(curr.latitude * Math.PI / 180) *
        Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const distance = R * c;
      
      totalDistance += distance;
    }

    return Math.round(totalDistance * 100) / 100; // Round to 2 decimal places
  };

  VehicleLocation.detectAnomalies = async function(vehicleId, maxSpeedKmh = 200, maxJumpKm = 5) {
    const recentLocations = await this.getRecentByVehicle(vehicleId, 30); // Last 30 minutes
    
    const anomalies = [];
    
    for (let i = 1; i < recentLocations.length; i++) {
      const prev = recentLocations[i - 1];
      const curr = recentLocations[i];
      
      // Check for unrealistic speed
      if (curr.speed && curr.speed > maxSpeedKmh) {
        anomalies.push({
          type: 'high_speed',
          timestamp: curr.timestamp,
          value: curr.speed,
          message: `Vehicle speed ${curr.speed} km/h exceeds maximum ${maxSpeedKmh} km/h`
        });
      }
      
      // Check for location jumps
      const timeDiff = (new Date(prev.timestamp) - new Date(curr.timestamp)) / 1000 / 3600; // hours
      const distance = this.calculateDistanceBetweenPoints(
        prev.latitude, prev.longitude,
        curr.latitude, curr.longitude
      );
      
      if (timeDiff > 0 && distance / timeDiff > maxSpeedKmh) {
        anomalies.push({
          type: 'location_jump',
          timestamp: curr.timestamp,
          value: distance,
          message: `Vehicle jumped ${distance.toFixed(2)} km in ${timeDiff.toFixed(2)} hours`
        });
      }
    }
    
    return anomalies;
  };

  VehicleLocation.calculateDistanceBetweenPoints = function(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  return VehicleLocation;
};
