module.exports = (sequelize, DataTypes) => {
  const VehicleCategory = sequelize.define('VehicleCategory', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: {
        len: [1, 100]
      }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    daily_rate: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      validate: {
        min: 0
      }
    },
    hourly_rate: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      validate: {
        min: 0
      }
    },
    per_km_rate: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      validate: {
        min: 0
      }
    }
  }, {
    tableName: 'vehicle_categories',
    timestamps: false,
    indexes: [
      {
        unique: true,
        fields: ['name']
      }
    ]
  });

  // Instance methods
  VehicleCategory.prototype.getDisplayName = function() {
    return this.name;
  };

  VehicleCategory.prototype.calculateCost = function(hours, distanceKm = 0) {
    let totalCost = 0;
    
    // Calculate time-based cost
    if (hours <= 24) {
      totalCost = this.hourly_rate * Math.ceil(hours);
    } else {
      const days = Math.ceil(hours / 24);
      const remainingHours = hours % 24;
      totalCost = (this.daily_rate * days) + 
                  (this.hourly_rate * Math.ceil(remainingHours));
    }
    
    // Add distance cost
    totalCost += distanceKm * this.per_km_rate;
    
    return Math.round(totalCost * 100) / 100; // Round to 2 decimal places
  };

  // Class methods
  VehicleCategory.findByName = function(name) {
    return this.findOne({ where: { name } });
  };

  VehicleCategory.getPopularCategories = function(limit = 5) {
    return this.findAll({
      include: [{
        model: require('./Vehicle'),
        as: 'vehicles',
        attributes: []
      }],
      attributes: [
        'id',
        'name',
        'description',
        'daily_rate',
        'hourly_rate',
        'per_km_rate',
        [
          sequelize.fn('COUNT', sequelize.col('vehicles.id')),
          'vehicle_count'
        ]
      ],
      group: ['VehicleCategory.id'],
      having: sequelize.where(sequelize.fn('COUNT', sequelize.col('vehicles.id')), '>', 0),
      order: [[sequelize.literal('vehicle_count'), 'DESC']],
      limit
    });
  };

  return VehicleCategory;
};
