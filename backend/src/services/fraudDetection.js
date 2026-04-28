const logger = require('../utils/logger');
const { VehicleLocation, Alert, Trip } = require('../config/database').models;

class FraudDetectionService {
  constructor() {
    this.thresholds = {
      maxSpeedKmh: parseInt(process.env.SPEED_LIMIT_KMH) || 200,
      locationJumpThresholdKm: parseInt(process.env.LOCATION_JUMP_THRESHOLD_KM) || 500,
      maxTripDurationHours: 24,
      minTripDurationMinutes: 5,
      suspiciousSpeedThreshold: 120, // km/h
      gpsAnomalyThreshold: 1000 // meters between consecutive points
    };
  }

  // Detect anomalies in vehicle location data
  async detectLocationAnomalies(vehicleId, timeWindowMinutes = 30) {
    try {
      const recentLocations = await VehicleLocation.getRecentByVehicle(vehicleId, timeWindowMinutes);
      const anomalies = [];

      for (let i = 1; i < recentLocations.length; i++) {
        const prev = recentLocations[i - 1];
        const curr = recentLocations[i];

        // Check for unrealistic speed
        if (curr.speed && curr.speed > this.thresholds.maxSpeedKmh) {
          anomalies.push({
            type: 'high_speed',
            severity: 'high',
            vehicle_id: vehicleId,
            timestamp: curr.timestamp,
            value: curr.speed,
            message: `Vehicle speed ${curr.speed} km/h exceeds maximum ${this.thresholds.maxSpeedKmh} km/h`,
            data: {
              location: { latitude: curr.latitude, longitude: curr.longitude },
              speed: curr.speed,
              heading: curr.heading
            }
          });
        }

        // Check for location jumps
        const timeDiff = (new Date(curr.timestamp) - new Date(prev.timestamp)) / 1000 / 3600; // hours
        const distance = VehicleLocation.calculateDistanceBetweenPoints(
          prev.latitude, prev.longitude,
          curr.latitude, curr.longitude
        );

        if (timeDiff > 0 && distance / timeDiff > this.thresholds.maxSpeedKmh) {
          anomalies.push({
            type: 'location_jump',
            severity: 'critical',
            vehicle_id: vehicleId,
            timestamp: curr.timestamp,
            value: distance,
            message: `Vehicle jumped ${distance.toFixed(2)} km in ${timeDiff.toFixed(2)} hours`,
            data: {
              from: { latitude: prev.latitude, longitude: prev.longitude },
              to: { latitude: curr.latitude, longitude: curr.longitude },
              distance: distance,
              time_hours: timeDiff
            }
          });
        }

        // Check for GPS anomalies (consecutive points too far apart in short time)
        if (distance > this.thresholds.gpsAnomalyThreshold / 1000 && timeDiff < 0.1) {
          anomalies.push({
            type: 'gps_anomaly',
            severity: 'medium',
            vehicle_id: vehicleId,
            timestamp: curr.timestamp,
            value: distance,
            message: `GPS anomaly: ${distance.toFixed(2)} km movement in ${(timeDiff * 60).toFixed(1)} minutes`,
            data: {
              from: { latitude: prev.latitude, longitude: prev.longitude },
              to: { latitude: curr.latitude, longitude: curr.longitude },
              distance: distance,
              time_minutes: timeDiff * 60
            }
          });
        }
      }

      return anomalies;
    } catch (error) {
      logger.error('Error detecting location anomalies:', error);
      return [];
    }
  }

  // Detect anomalies in trip data
  async detectTripAnomalies(tripId) {
    try {
      const trip = await Trip.findByPk(tripId, {
        include: ['vehicle', 'driver']
      });

      if (!trip || trip.status !== 'completed') {
        return [];
      }

      const anomalies = [];

      // Check for unusually long trips
      if (trip.duration_minutes > this.thresholds.maxTripDurationHours * 60) {
        anomalies.push({
          type: 'long_duration',
          severity: 'medium',
          vehicle_id: trip.vehicle_id,
          trip_id: trip.id,
          timestamp: trip.end_time,
          value: trip.duration_minutes,
          message: `Trip duration ${trip.duration_minutes} minutes exceeds maximum ${this.thresholds.maxTripDurationHours * 60} minutes`,
          data: {
            duration_minutes: trip.duration_minutes,
            start_time: trip.start_time,
            end_time: trip.end_time
          }
        });
      }

      // Check for unusually short trips
      if (trip.duration_minutes < this.thresholds.minTripDurationMinutes) {
        anomalies.push({
          type: 'short_duration',
          severity: 'low',
          vehicle_id: trip.vehicle_id,
          trip_id: trip.id,
          timestamp: trip.end_time,
          value: trip.duration_minutes,
          message: `Trip duration ${trip.duration_minutes} minutes is unusually short`,
          data: {
            duration_minutes: trip.duration_minutes,
            start_time: trip.start_time,
            end_time: trip.end_time
          }
        });
      }

      // Check for high average speed
      const avgSpeed = trip.getAverageSpeed();
      if (avgSpeed > this.thresholds.suspiciousSpeedThreshold) {
        anomalies.push({
          type: 'high_average_speed',
          severity: 'high',
          vehicle_id: trip.vehicle_id,
          trip_id: trip.id,
          timestamp: trip.end_time,
          value: avgSpeed,
          message: `Average speed ${avgSpeed.toFixed(2)} km/h exceeds suspicious threshold ${this.thresholds.suspiciousSpeedThreshold} km/h`,
          data: {
            average_speed: avgSpeed,
            distance_km: trip.distance_km,
            duration_minutes: trip.duration_minutes
          }
        });
      }

      // Check for odometer inconsistencies
      if (trip.start_odometer && trip.end_odometer && trip.distance_km) {
        const odometerDistance = (trip.end_odometer - trip.start_odometer) / 1000; // Convert to km
        const gpsDistance = trip.distance_km;
        const discrepancy = Math.abs(odometerDistance - gpsDistance);

        if (discrepancy > gpsDistance * 0.5 && discrepancy > 10) { // 50% discrepancy or >10km
          anomalies.push({
            type: 'odometer_discrepancy',
            severity: 'medium',
            vehicle_id: trip.vehicle_id,
            trip_id: trip.id,
            timestamp: trip.end_time,
            value: discrepancy,
            message: `Odometer discrepancy: ${discrepancy.toFixed(2)} km difference between odometer and GPS`,
            data: {
              odometer_distance: odometerDistance,
              gps_distance: gpsDistance,
              discrepancy: discrepancy,
              start_odometer: trip.start_odometer,
              end_odometer: trip.end_odometer
            }
          });
        }
      }

      return anomalies;
    } catch (error) {
      logger.error('Error detecting trip anomalies:', error);
      return [];
    }
  }

  // Detect booking patterns that might indicate fraud
  async detectBookingAnomalies(userId, timeWindowDays = 30) {
    try {
      const Booking = require('./Booking');
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - timeWindowDays);

      const bookings = await Booking.findAll({
        where: {
          customer_id: userId,
          created_at: {
            [require('sequelize').Sequelize.Op.between]: [startDate, endDate]
          }
        },
        include: ['vehicle'],
        order: [['created_at', 'DESC']]
      });

      const anomalies = [];

      // Check for rapid booking patterns
      const recentBookings = bookings.filter(booking => 
        (new Date() - new Date(booking.created_at)) / (1000 * 60 * 60) < 24 // Last 24 hours
      );

      if (recentBookings.length > 5) {
        anomalies.push({
          type: 'rapid_booking_pattern',
          severity: 'medium',
          user_id: userId,
          timestamp: new Date(),
          value: recentBookings.length,
          message: `User created ${recentBookings.length} bookings in the last 24 hours`,
          data: {
            booking_count: recentBookings.length,
            time_window_hours: 24,
            bookings: recentBookings.map(b => ({
              id: b.id,
              created_at: b.created_at,
              vehicle_id: b.vehicle_id
            }))
          }
        });
      }

      // Check for high cancellation rate
      const cancelledBookings = bookings.filter(booking => booking.status === 'cancelled');
      const cancellationRate = bookings.length > 0 ? (cancelledBookings.length / bookings.length) * 100 : 0;

      if (cancellationRate > 50 && bookings.length >= 3) {
        anomalies.push({
          type: 'high_cancellation_rate',
          severity: 'low',
          user_id: userId,
          timestamp: new Date(),
          value: cancellationRate,
          message: `User has ${cancellationRate.toFixed(1)}% cancellation rate`,
          data: {
            total_bookings: bookings.length,
            cancelled_bookings: cancelledBookings.length,
            cancellation_rate: cancellationRate
          }
        });
      }

      return anomalies;
    } catch (error) {
      logger.error('Error detecting booking anomalies:', error);
      return [];
    }
  }

  // Create alerts for detected anomalies
  async createAlertsForAnomalies(anomalies) {
    const alerts = [];
    
    for (const anomaly of anomalies) {
      try {
        const alert = await Alert.createAlert({
          vehicle_id: anomaly.vehicle_id || null,
          alert_type: anomaly.type,
          severity: anomaly.severity,
          message: anomaly.message
        });
        
        alerts.push(alert);
        logger.warn(`Fraud alert created: ${alert.id} - ${anomaly.message}`);
      } catch (error) {
        logger.error('Error creating fraud alert:', error);
      }
    }

    return alerts;
  }

  // Run comprehensive fraud detection for a vehicle
  async runFraudDetectionForVehicle(vehicleId, timeWindowMinutes = 30) {
    try {
      logger.info(`Running fraud detection for vehicle ${vehicleId}`);
      
      // Detect location anomalies
      const locationAnomalies = await this.detectLocationAnomalies(vehicleId, timeWindowMinutes);
      
      // Create alerts for location anomalies
      const locationAlerts = await this.createAlertsForAnomalies(locationAnomalies);
      
      // Detect trip anomalies for recent completed trips
      const recentTrips = await Trip.findAll({
        where: {
          vehicle_id: vehicleId,
          status: 'completed',
          end_time: {
            [require('sequelize').Sequelize.Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
          }
        }
      });

      const tripAnomalies = [];
      for (const trip of recentTrips) {
        const anomalies = await this.detectTripAnomalies(trip.id);
        tripAnomalies.push(...anomalies);
      }

      // Create alerts for trip anomalies
      const tripAlerts = await this.createAlertsForAnomalies(tripAnomalies);

      logger.info(`Fraud detection completed for vehicle ${vehicleId}: ${locationAlerts.length + tripAlerts.length} alerts created`);
      
      return {
        locationAnomalies,
        tripAnomalies,
        alertsCreated: locationAlerts.length + tripAlerts.length
      };
    } catch (error) {
      logger.error('Error running fraud detection for vehicle:', error);
      return {
        locationAnomalies: [],
        tripAnomalies: [],
        alertsCreated: 0,
        error: error.message
      };
    }
  }

  // Run fraud detection for all vehicles (scheduled task)
  async runGlobalFraudDetection() {
    try {
      logger.info('Running global fraud detection');
      
      const Vehicle = require('./Vehicle');
      const vehicles = await Vehicle.findAll({
        where: { is_active: true }
      });

      const results = [];
      
      for (const vehicle of vehicles) {
        const result = await this.runFraudDetectionForVehicle(vehicle.id);
        results.push({
          vehicle_id: vehicle.id,
          license_plate: vehicle.license_plate,
          ...result
        });
      }

      logger.info(`Global fraud detection completed: ${results.length} vehicles checked`);
      
      return results;
    } catch (error) {
      logger.error('Error running global fraud detection:', error);
      return [];
    }
  }
}

module.exports = new FraudDetectionService();
