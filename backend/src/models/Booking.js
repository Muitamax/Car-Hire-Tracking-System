module.exports = (sequelize, DataTypes) => {
  const Booking = sequelize.define('Booking', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    customer_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
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
    pickup_datetime: {
      type: DataTypes.DATE,
      allowNull: false,
      validate: {
        isDate: true,
        isAfterToday(value) {
          if (new Date(value) <= new Date()) {
            throw new Error('Pickup datetime must be in the future');
          }
        }
      }
    },
    return_datetime: {
      type: DataTypes.DATE,
      allowNull: false,
      validate: {
        isDate: true,
        isAfterPickup(value) {
          if (new Date(value) <= new Date(this.pickup_datetime)) {
            throw new Error('Return datetime must be after pickup datetime');
          }
        }
      }
    },
    actual_pickup_datetime: {
      type: DataTypes.DATE,
      allowNull: true
    },
    actual_return_datetime: {
      type: DataTypes.DATE,
      allowNull: true
    },
    pickup_location: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    dropoff_location: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    total_cost: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      validate: {
        min: 0
      }
    },
    status: {
      type: DataTypes.ENUM('pending', 'confirmed', 'active', 'completed', 'cancelled'),
      allowNull: false,
      defaultValue: 'pending'
    },
    payment_status: {
      type: DataTypes.ENUM('pending', 'paid', 'refunded'),
      allowNull: false,
      defaultValue: 'pending'
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  }, {
    tableName: 'bookings',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        fields: ['customer_id']
      },
      {
        fields: ['vehicle_id']
      },
      {
        fields: ['status']
      },
      {
        fields: ['payment_status']
      },
      {
        fields: ['pickup_datetime', 'return_datetime']
      },
      {
        unique: true,
        fields: ['vehicle_id', 'pickup_datetime', 'return_datetime'],
        name: 'no_overlapping_bookings',
        where: {
          status: ['confirmed', 'active']
        }
      }
    ]
  });

  // Instance methods
  Booking.prototype.updateStatus = async function(newStatus) {
    const oldStatus = this.status;
    this.status = newStatus;
    await this.save();
    
    // Update vehicle status based on booking status
    const Vehicle = require('./Vehicle');
    const vehicle = await Vehicle.findByPk(this.vehicle_id);
    
    if (vehicle) {
      switch (newStatus) {
        case 'confirmed':
          await vehicle.updateStatus('booked');
          break;
        case 'active':
          await vehicle.updateStatus('in_use');
          this.actual_pickup_datetime = new Date();
          await this.save();
          break;
        case 'completed':
          await vehicle.updateStatus('available');
          this.actual_return_datetime = new Date();
          await this.save();
          break;
        case 'cancelled':
          await vehicle.updateStatus('available');
          break;
      }
    }
    
    return this;
  };

  Booking.prototype.calculateCost = async function() {
    const Vehicle = require('./Vehicle');
    const VehicleCategory = require('./VehicleCategory');
    
    const vehicle = await Vehicle.findByPk(this.vehicle_id, {
      include: [{ model: VehicleCategory, as: 'category' }]
    });
    
    if (!vehicle) {
      throw new Error('Vehicle not found');
    }

    const pickup = new Date(this.pickup_datetime);
    const returnDtime = new Date(this.return_datetime);
    const durationHours = (returnDtime - pickup) / (1000 * 60 * 60);
    
    let totalCost = 0;
    
    // Calculate cost based on duration
    if (durationHours <= 24) {
      totalCost = vehicle.category.hourly_rate * Math.ceil(durationHours);
    } else {
      const days = Math.ceil(durationHours / 24);
      const remainingHours = durationHours % 24;
      totalCost = (vehicle.category.daily_rate * days) + 
                  (vehicle.category.hourly_rate * Math.ceil(remainingHours));
    }
    
    this.total_cost = totalCost;
    await this.save();
    
    return totalCost;
  };

  Booking.prototype.isActive = function() {
    return this.status === 'active';
  };

  Booking.prototype.isCompleted = function() {
    return this.status === 'completed';
  };

  Booking.prototype.isPending = function() {
    return this.status === 'pending';
  };

  // Class methods
  Booking.findActiveBookings = function() {
    return this.findAll({
      where: { status: 'active' },
      include: ['customer', 'vehicle']
    });
  };

  Booking.findByCustomer = function(customerId, status = null) {
    const whereClause = { customer_id: customerId };
    if (status) {
      whereClause.status = status;
    }
    
    return this.findAll({
      where: whereClause,
      include: ['vehicle'],
      order: [['created_at', 'DESC']]
    });
  };

  Booking.findByVehicle = function(vehicleId, startDate, endDate) {
    const whereClause = { vehicle_id: vehicleId };
    
    if (startDate && endDate) {
      whereClause[sequelize.Sequelize.Op.and] = [
        {
          pickup_datetime: {
            [sequelize.Sequelize.Op.lt]: endDate
          }
        },
        {
          return_datetime: {
            [sequelize.Sequelize.Op.gt]: startDate
          }
        }
      ];
    }
    
    return this.findAll({
      where: whereClause,
      include: ['customer']
    });
  };

  Booking.findOverlappingBookings = function(vehicleId, pickupDate, returnDate, excludeBookingId = null) {
    const whereClause = {
      vehicle_id: vehicleId,
      status: ['confirmed', 'active'],
      [sequelize.Sequelize.Op.and]: [
        {
          pickup_datetime: {
            [sequelize.Sequelize.Op.lt]: returnDate
          }
        },
        {
          return_datetime: {
            [sequelize.Sequelize.Op.gt]: pickupDate
          }
        }
      ]
    };
    
    if (excludeBookingId) {
      whereClause.id = {
        [sequelize.Sequelize.Op.ne]: excludeBookingId
      };
    }
    
    return this.findAll({ where: whereClause });
  };

  return Booking;
};
