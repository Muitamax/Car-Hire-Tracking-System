module.exports = (sequelize, DataTypes) => {
  const Vehicle = sequelize.define('Vehicle', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    make: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: {
        len: [1, 100]
      }
    },
    model: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: {
        len: [1, 100]
      }
    },
    year: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1900,
        max: new Date().getFullYear() + 1
      }
    },
    license_plate: {
      type: DataTypes.STRING(20),
      allowNull: false,
      unique: true,
      validate: {
        len: [1, 20]
      }
    },
    vin: {
      type: DataTypes.STRING(50),
      allowNull: true,
      unique: true,
      validate: {
        len: [11, 50]
      }
    },
    category_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'vehicle_categories',
        key: 'id'
      }
    },
    status: {
      type: DataTypes.ENUM('available', 'booked', 'in_use', 'maintenance', 'offline'),
      allowNull: false,
      defaultValue: 'available'
    },
    current_latitude: {
      type: DataTypes.DECIMAL(10, 8),
      allowNull: true,
      validate: {
        min: -90,
        max: 90
      }
    },
    current_longitude: {
      type: DataTypes.DECIMAL(11, 8),
      allowNull: true,
      validate: {
        min: -180,
        max: 180
      }
    },
    last_location_update: {
      type: DataTypes.DATE,
      allowNull: true
    },
    odometer: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      validate: {
        min: 0
      }
    },
    fuel_level: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      validate: {
        min: 0,
        max: 100
      }
    },
    last_maintenance: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    next_maintenance_due: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    }
  }, {
    tableName: 'vehicles',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        unique: true,
        fields: ['license_plate']
      },
      {
        unique: true,
        fields: ['vin']
      },
      {
        fields: ['status']
      },
      {
        fields: ['category_id']
      },
      {
        fields: ['is_active']
      },
      {
        fields: ['current_latitude', 'current_longitude']
      }
    ]
  });

  // Instance methods
  Vehicle.prototype.updateLocation = async function(latitude, longitude) {
    this.current_latitude = latitude;
    this.current_longitude = longitude;
    this.last_location_update = new Date();
    return await this.save();
  };

  Vehicle.prototype.updateStatus = async function(newStatus) {
    const oldStatus = this.status;
    this.status = newStatus;
    await this.save();
    
    // Log status change
    require('../utils/logger').info(`Vehicle ${this.id} status changed from ${oldStatus} to ${newStatus}`);
    return this;
  };

  Vehicle.prototype.isAvailable = function() {
    return this.status === 'available' && this.is_active;
  };

  Vehicle.prototype.needsMaintenance = function() {
    if (!this.next_maintenance_due) return false;
    return new Date() >= new Date(this.next_maintenance_due);
  };

  Vehicle.prototype.getFullName = function() {
    return `${this.year} ${this.make} ${this.model}`;
  };

  // Class methods
  Vehicle.findAvailable = function(categoryId = null) {
    const whereClause = {
      status: 'available',
      is_active: true
    };
    
    if (categoryId) {
      whereClause.category_id = categoryId;
    }
    
    return this.findAll({ where: whereClause });
  };

  Vehicle.findByStatus = function(status) {
    return this.findAll({ 
      where: { 
        status,
        is_active: true 
      } 
    });
  };

  Vehicle.findInGeoFence = function(latitude, longitude, radiusKm = 1) {
    // This would use PostGIS for actual geo queries
    // For now, return all active vehicles
    return this.findAll({
      where: {
        is_active: true,
        current_latitude: {
          [sequelize.Sequelize.Op.between]: [
            latitude - (radiusKm / 111), // Approximate conversion
            latitude + (radiusKm / 111)
          ]
        },
        current_longitude: {
          [sequelize.Sequelize.Op.between]: [
            longitude - (radiusKm / (111 * Math.cos(latitude * Math.PI / 180))),
            longitude + (radiusKm / (111 * Math.cos(latitude * Math.PI / 180)))
          ]
        }
      }
    });
  };

  return Vehicle;
};
