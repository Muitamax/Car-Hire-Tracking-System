import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import axios from 'axios';

const Dashboard = () => {
  const { user } = useAuth();
  const { connected } = useSocket();
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const response = await axios.get('/api/analytics/dashboard');
      setDashboardData(response.data);
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
      setError('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center text-red-600">
        <p>{error}</p>
        <button
          onClick={fetchDashboardData}
          className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Retry
        </button>
      </div>
    );
  }

  const isAdmin = user?.role === 'admin';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-600">
          Welcome back, {user?.first_name}! Here's what's happening with your car hire system.
        </p>
      </div>

      {/* Connection Status */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <div className={`w-3 h-3 rounded-full mr-3 ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-sm font-medium text-gray-900">
              Real-time Updates: {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          <span className="text-xs text-gray-500">
            WebSocket Status
          </span>
        </div>
      </div>

      {isAdmin && dashboardData ? (
        <>
          {/* Admin Overview Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0 bg-blue-100 rounded-md p-3">
                  <span className="text-2xl">🚗</span>
                </div>
                <div className="ml-4">
                  <h3 className="text-lg font-medium text-gray-900">Total Vehicles</h3>
                  <p className="text-2xl font-bold text-blue-600">{dashboardData.overview.total_vehicles}</p>
                  <p className="text-sm text-gray-500">{dashboardData.overview.available_vehicles} available</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0 bg-green-100 rounded-md p-3">
                  <span className="text-2xl">📅</span>
                </div>
                <div className="ml-4">
                  <h3 className="text-lg font-medium text-gray-900">Active Bookings</h3>
                  <p className="text-2xl font-bold text-green-600">{dashboardData.overview.active_bookings}</p>
                  <p className="text-sm text-gray-500">{dashboardData.overview.total_bookings} total</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0 bg-yellow-100 rounded-md p-3">
                  <span className="text-2xl">👥</span>
                </div>
                <div className="ml-4">
                  <h3 className="text-lg font-medium text-gray-900">Total Users</h3>
                  <p className="text-2xl font-bold text-yellow-600">{dashboardData.overview.total_users}</p>
                  <p className="text-sm text-gray-500">Registered customers</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0 bg-purple-100 rounded-md p-3">
                  <span className="text-2xl">💰</span>
                </div>
                <div className="ml-4">
                  <h3 className="text-lg font-medium text-gray-900">Revenue</h3>
                  <p className="text-2xl font-bold text-purple-600">
                    ${dashboardData.overview.total_revenue?.toFixed(2) || '0.00'}
                  </p>
                  <p className="text-sm text-gray-500">Last {dashboardData.period_days} days</p>
                </div>
              </div>
            </div>
          </div>

          {/* Vehicle Status Distribution */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Vehicle Status Distribution</h3>
              <div className="space-y-3">
                {dashboardData.vehicle_status_distribution?.map((status) => (
                  <div key={status.status} className="flex items-center justify-between">
                    <div className="flex items-center">
                      <div className={`w-3 h-3 rounded-full mr-2 ${
                        status.status === 'available' ? 'bg-green-500' :
                        status.status === 'booked' ? 'bg-yellow-500' :
                        status.status === 'in_use' ? 'bg-blue-500' :
                        status.status === 'maintenance' ? 'bg-red-500' :
                        'bg-gray-500'
                      }`} />
                      <span className="text-sm font-medium text-gray-900 capitalize">{status.status}</span>
                    </div>
                    <span className="text-sm text-gray-600">{status.count} vehicles</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Most Active Vehicles</h3>
              <div className="space-y-3">
                {dashboardData.most_active_vehicles?.slice(0, 5).map((vehicle, index) => (
                  <div key={vehicle.vehicle_id} className="flex items-center justify-between">
                    <div className="flex items-center">
                      <span className="text-sm font-medium text-gray-900 mr-2">#{index + 1}</span>
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {vehicle.vehicle.make} {vehicle.vehicle.model}
                        </p>
                        <p className="text-xs text-gray-500">{vehicle.vehicle.license_plate}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-gray-900">{vehicle.trip_count} trips</p>
                      <p className="text-xs text-gray-500">{vehicle.total_distance?.toFixed(1)} km</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      ) : (
        /* Customer Dashboard */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0 bg-blue-100 rounded-md p-3">
                <span className="text-2xl">🚗</span>
              </div>
              <div className="ml-4">
                <h3 className="text-lg font-medium text-gray-900">Browse Vehicles</h3>
                <p className="text-sm text-gray-600">View available vehicles</p>
              </div>
            </div>
            <Link
              to="/vehicles"
              className="mt-4 block w-full text-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              View Vehicles
            </Link>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0 bg-green-100 rounded-md p-3">
                <span className="text-2xl">📅</span>
              </div>
              <div className="ml-4">
                <h3 className="text-lg font-medium text-gray-900">My Bookings</h3>
                <p className="text-sm text-gray-600">Manage your bookings</p>
              </div>
            </div>
            <Link
              to="/bookings"
              className="mt-4 block w-full text-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
            >
              View Bookings
            </Link>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0 bg-purple-100 rounded-md p-3">
                <span className="text-2xl">🗺️</span>
              </div>
              <div className="ml-4">
                <h3 className="text-lg font-medium text-gray-900">Trip History</h3>
                <p className="text-sm text-gray-600">View past trips</p>
              </div>
            </div>
            <Link
              to="/trips"
              className="mt-4 block w-full text-center px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
            >
              View Trips
            </Link>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Quick Actions</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Link
            to="/vehicles"
            className="flex items-center justify-center px-4 py-3 bg-gray-50 rounded-md hover:bg-gray-100 transition-colors"
          >
            <span className="mr-2">🚗</span>
            <span className="text-sm font-medium text-gray-900">Browse Vehicles</span>
          </Link>
          <Link
            to="/bookings"
            className="flex items-center justify-center px-4 py-3 bg-gray-50 rounded-md hover:bg-gray-100 transition-colors"
          >
            <span className="mr-2">📅</span>
            <span className="text-sm font-medium text-gray-900">View Bookings</span>
          </Link>
          <Link
            to="/trips"
            className="flex items-center justify-center px-4 py-3 bg-gray-50 rounded-md hover:bg-gray-100 transition-colors"
          >
            <span className="mr-2">🗺️</span>
            <span className="text-sm font-medium text-gray-900">Trip History</span>
          </Link>
          <Link
            to="/profile"
            className="flex items-center justify-center px-4 py-3 bg-gray-50 rounded-md hover:bg-gray-100 transition-colors"
          >
            <span className="mr-2">👤</span>
            <span className="text-sm font-medium text-gray-900">Profile</span>
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
