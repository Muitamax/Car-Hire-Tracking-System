const { Sequelize } = require('sequelize');
const logger = require('../utils/logger');

// Database configuration
const sequelize = new Sequelize(
  process.env.DB_NAME || 'car_hire_tracking',
  process.env.DB_USER || 'postgres',
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: (msg) => logger.debug(msg),
    pool: {
      max: 20,
      min: 5,
      acquire: 30000,
      idle: 10000
    },
    dialectOptions: {
      ssl: process.env.DB_SSL === 'true' ? {
        require: true,
        rejectUnauthorized: false
      } : false
    },
    define: {
      timestamps: true,
      underscored: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    }
  }
);

// Import models
const User = require('../models/User')(sequelize, Sequelize.DataTypes);
const VehicleCategory = require('../models/VehicleCategory')(sequelize, Sequelize.DataTypes);
const Vehicle = require('../models/Vehicle')(sequelize, Sequelize.DataTypes);
const GeoFence = require('../models/GeoFence')(sequelize, Sequelize.DataTypes);
const VehicleGeoFence = require('../models/VehicleGeoFence')(sequelize, Sequelize.DataTypes);
const Booking = require('../models/Booking')(sequelize, Sequelize.DataTypes);
const Trip = require('../models/Trip')(sequelize, Sequelize.DataTypes);
const VehicleLocation = require('../models/VehicleLocation')(sequelize, Sequelize.DataTypes);
const Alert = require('../models/Alert')(sequelize, Sequelize.DataTypes);
const MaintenanceRecord = require('../models/MaintenanceRecord')(sequelize, Sequelize.DataTypes);
const Payment = require('../models/Payment')(sequelize, Sequelize.DataTypes);
const AuditLog = require('../models/AuditLog')(sequelize, Sequelize.DataTypes);

// Define associations
const associations = () => {
  // User relationships
  User.hasMany(Booking, { foreignKey: 'customer_id', as: 'bookings' });
  User.hasMany(Trip, { foreignKey: 'driver_id', as: 'trips' });
  User.hasMany(Alert, { foreignKey: 'resolved_by', as: 'resolvedAlerts' });

  // Vehicle relationships
  Vehicle.belongsTo(VehicleCategory, { foreignKey: 'category_id', as: 'category' });
  VehicleCategory.hasMany(Vehicle, { foreignKey: 'category_id', as: 'vehicles' });
  
  Vehicle.hasMany(Booking, { foreignKey: 'vehicle_id', as: 'bookings' });
  Vehicle.hasMany(Trip, { foreignKey: 'vehicle_id', as: 'trips' });
  Vehicle.hasMany(VehicleLocation, { foreignKey: 'vehicle_id', as: 'locations' });
  Vehicle.hasMany(Alert, { foreignKey: 'vehicle_id', as: 'alerts' });
  Vehicle.hasMany(MaintenanceRecord, { foreignKey: 'vehicle_id', as: 'maintenanceRecords' });
  
  // Geo-fence relationships
  Vehicle.belongsToMany(GeoFence, { 
    through: VehicleGeoFence, 
    foreignKey: 'vehicle_id',
    otherKey: 'geo_fence_id',
    as: 'geoFences'
  });
  GeoFence.belongsToMany(Vehicle, { 
    through: VehicleGeoFence, 
    foreignKey: 'geo_fence_id',
    otherKey: 'vehicle_id',
    as: 'vehicles'
  });

  // Booking relationships
  Booking.belongsTo(User, { foreignKey: 'customer_id', as: 'customer' });
  Booking.belongsTo(Vehicle, { foreignKey: 'vehicle_id', as: 'vehicle' });
  Booking.hasMany(Trip, { foreignKey: 'booking_id', as: 'trips' });
  Booking.hasMany(Payment, { foreignKey: 'booking_id', as: 'payments' });

  // Trip relationships
  Trip.belongsTo(Booking, { foreignKey: 'booking_id', as: 'booking' });
  Trip.belongsTo(Vehicle, { foreignKey: 'vehicle_id', as: 'vehicle' });
  Trip.belongsTo(User, { foreignKey: 'driver_id', as: 'driver' });

  // Payment relationships
  Payment.belongsTo(Booking, { foreignKey: 'booking_id', as: 'booking' });

  // Alert relationships
  Alert.belongsTo(Vehicle, { foreignKey: 'vehicle_id', as: 'vehicle' });
  Alert.belongsTo(User, { foreignKey: 'resolved_by', as: 'resolver' });

  // Maintenance relationships
  MaintenanceRecord.belongsTo(Vehicle, { foreignKey: 'vehicle_id', as: 'vehicle' });
};

// Initialize associations
associations();

// Test database connection
const testConnection = async () => {
  try {
    await sequelize.authenticate();
    logger.info('Database connection has been established successfully.');
  } catch (error) {
    logger.error('Unable to connect to the database:', error);
    throw error;
  }
};

module.exports = {
  sequelize,
  Sequelize,
  models: {
    User,
    VehicleCategory,
    Vehicle,
    GeoFence,
    VehicleGeoFence,
    Booking,
    Trip,
    VehicleLocation,
    Alert,
    MaintenanceRecord,
    Payment,
    AuditLog
  },
  testConnection
};
