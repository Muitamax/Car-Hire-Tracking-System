import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';
import toast from 'react-hot-toast';

const SocketContext = createContext();

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const { token, isAuthenticated } = useAuth();

  useEffect(() => {
    if (isAuthenticated && token) {
      // Initialize socket connection
      const newSocket = io(import.meta.env.VITE_WS_URL || 'http://localhost:3000', {
        auth: {
          token: token
        },
        transports: ['websocket', 'polling']
      });

      newSocket.on('connect', () => {
        console.log('Connected to WebSocket server');
        setConnected(true);
        toast.success('Real-time updates connected');
      });

      newSocket.on('disconnect', () => {
        console.log('Disconnected from WebSocket server');
        setConnected(false);
        toast.error('Real-time updates disconnected');
      });

      newSocket.on('connect_error', (error) => {
        console.error('WebSocket connection error:', error);
        setConnected(false);
        toast.error('Failed to connect to real-time updates');
      });

      // Handle location updates
      newSocket.on('location_update', (data) => {
        console.log('Location update received:', data);
        // This will be handled by components that subscribe to location updates
      });

      // Handle trip events
      newSocket.on('trip_started', (data) => {
        console.log('Trip started:', data);
        toast.success('Trip started successfully');
      });

      newSocket.on('trip_ended', (data) => {
        console.log('Trip ended:', data);
        toast.success('Trip completed');
      });

      // Handle booking updates
      newSocket.on('booking_update', (data) => {
        console.log('Booking update:', data);
        // This will be handled by components that subscribe to booking updates
      });

      // Handle vehicle status updates
      newSocket.on('vehicle_status_update', (data) => {
        console.log('Vehicle status update:', data);
        // This will be handled by components that subscribe to vehicle updates
      });

      // Handle alerts
      newSocket.on('new_alert', (data) => {
        console.log('New alert:', data);
        if (data.severity === 'critical' || data.severity === 'high') {
          toast.error(`Alert: ${data.message}`, {
            duration: 10000,
            icon: '⚠️'
          });
        } else {
          toast(`Alert: ${data.message}`, {
            duration: 5000,
            icon: '🔔'
          });
        }
      });

      // Handle error messages
      newSocket.on('error', (data) => {
        console.error('Socket error:', data);
        toast.error(data.message || 'Socket error occurred');
      });

      setSocket(newSocket);

      return () => {
        newSocket.close();
        setSocket(null);
        setConnected(false);
      };
    }
  }, [isAuthenticated, token]);

  // Subscribe to vehicle tracking
  const subscribeToVehicleTracking = (vehicleIds) => {
    if (socket && connected) {
      socket.emit('subscribe_vehicle_tracking', { vehicleIds });
    }
  };

  // Subscribe to alerts
  const subscribeToAlerts = () => {
    if (socket && connected) {
      socket.emit('subscribe_alerts');
    }
  };

  // Get vehicle status
  const getVehicleStatus = (vehicleId) => {
    if (socket && connected) {
      socket.emit('get_vehicle_status', { vehicle_id: vehicleId });
    }
  };

  // Start trip
  const startTrip = (bookingId, startLatitude, startLongitude) => {
    if (socket && connected) {
      socket.emit('start_trip', {
        booking_id: bookingId,
        start_latitude: startLatitude,
        start_longitude: startLongitude
      });
    }
  };

  // End trip
  const endTrip = (tripId, endLatitude, endLongitude, endOdometer) => {
    if (socket && connected) {
      socket.emit('end_trip', {
        trip_id: tripId,
        end_latitude: endLatitude,
        end_longitude: endLongitude,
        end_odometer: endOdometer
      });
    }
  };

  // Update vehicle location (admin only)
  const updateVehicleLocation = (vehicleId, latitude, longitude, speed, heading) => {
    if (socket && connected) {
      socket.emit('vehicle_location_update', {
        vehicle_id: vehicleId,
        latitude,
        longitude,
        speed,
        heading
      });
    }
  };

  const value = {
    socket,
    connected,
    subscribeToVehicleTracking,
    subscribeToAlerts,
    getVehicleStatus,
    startTrip,
    endTrip,
    updateVehicleLocation
  };

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};

export default SocketContext;
