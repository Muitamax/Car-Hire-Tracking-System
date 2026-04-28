import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useSocket } from '../contexts/SocketContext';
import axios from 'axios';

const Vehicles = () => {
  const { connected } = useSocket();
  const [vehicles, setVehicles] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({
    status: '',
    category_id: '',
    available_only: false
  });

  useEffect(() => {
    fetchVehicles();
    fetchCategories();
  }, [filters]);

  const fetchVehicles = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filters.status) params.append('status', filters.status);
      if (filters.category_id) params.append('category_id', filters.category_id);
      if (filters.available_only) params.append('available_only', 'true');

      const response = await axios.get(`/api/vehicles?${params}`);
      setVehicles(response.data.vehicles);
    } catch (error) {
      console.error('Failed to fetch vehicles:', error);
      setError('Failed to load vehicles');
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const response = await axios.get('/api/vehicles/categories/all');
      setCategories(response.data.categories);
    } catch (error) {
      console.error('Failed to fetch categories:', error);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'available': return 'bg-green-100 text-green-800';
      case 'booked': return 'bg-yellow-100 text-yellow-800';
      case 'in_use': return 'bg-blue-100 text-blue-800';
      case 'maintenance': return 'bg-red-100 text-red-800';
      case 'offline': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Vehicles</h1>
        <p className="mt-1 text-sm text-gray-600">
          Browse and manage your vehicle fleet
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Status
            </label>
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Statuses</option>
              <option value="available">Available</option>
              <option value="booked">Booked</option>
              <option value="in_use">In Use</option>
              <option value="maintenance">Maintenance</option>
              <option value="offline">Offline</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Category
            </label>
            <select
              value={filters.category_id}
              onChange={(e) => setFilters({ ...filters, category_id: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Categories</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name} (${category.daily_rate}/day)
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={filters.available_only}
                onChange={(e) => setFilters({ ...filters, available_only: e.target.checked })}
                className="mr-2 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700">Available Only</span>
            </label>
          </div>

          <div className="flex items-end">
            <button
              onClick={() => setFilters({ status: '', category_id: '', available_only: false })}
              className="w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
            >
              Clear Filters
            </button>
          </div>
        </div>
      </div>

      {/* Connection Status */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <div className={`w-2 h-2 rounded-full mr-2 ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-sm text-gray-600">
              Real-time tracking {connected ? 'active' : 'inactive'}
            </span>
          </div>
          <span className="text-xs text-gray-500">
            {vehicles.length} vehicles found
          </span>
        </div>
      </div>

      {/* Vehicles Grid */}
      {error ? (
        <div className="text-center text-red-600">
          <p>{error}</p>
          <button
            onClick={fetchVehicles}
            className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {vehicles.map((vehicle) => (
            <div key={vehicle.id} className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow">
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium text-gray-900">
                    {vehicle.year} {vehicle.make} {vehicle.model}
                  </h3>
                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(vehicle.status)}`}>
                    {vehicle.status.replace('_', ' ')}
                  </span>
                </div>

                <div className="space-y-2 text-sm text-gray-600">
                  <div className="flex justify-between">
                    <span>License Plate:</span>
                    <span className="font-medium">{vehicle.license_plate}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Category:</span>
                    <span className="font-medium">{vehicle.category?.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Daily Rate:</span>
                    <span className="font-medium">${vehicle.category?.daily_rate}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Fuel Level:</span>
                    <span className="font-medium">{vehicle.fuel_level || 'N/A'}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Odometer:</span>
                    <span className="font-medium">{vehicle.odometer?.toLocaleString() || 'N/A'} km</span>
                  </div>
                </div>

                {vehicle.latest_location && (
                  <div className="mt-4 p-3 bg-gray-50 rounded-md">
                    <div className="flex items-center text-sm text-gray-600">
                      <span className="mr-2">📍</span>
                      <span>Last seen: {new Date(vehicle.latest_location.timestamp).toLocaleString()}</span>
                    </div>
                    {vehicle.latest_location.speed && (
                      <div className="flex items-center text-sm text-gray-600 mt-1">
                        <span className="mr-2">⚡</span>
                        <span>Speed: {vehicle.latest_location.speed} km/h</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-4 flex space-x-2">
                  <button
                    className="flex-1 px-3 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
                    onClick={() => {
                      // Subscribe to real-time updates for this vehicle
                      console.log('Subscribe to vehicle:', vehicle.id);
                    }}
                  >
                    Track
                  </button>
                  <button
                    className="flex-1 px-3 py-2 bg-green-600 text-white text-sm rounded-md hover:bg-green-700"
                    disabled={vehicle.status !== 'available'}
                  >
                    Book
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {vehicles.length === 0 && !loading && !error && (
        <div className="text-center py-12">
          <span className="text-4xl">🚗</span>
          <h3 className="mt-2 text-lg font-medium text-gray-900">No vehicles found</h3>
          <p className="mt-1 text-sm text-gray-500">
            Try adjusting your filters or check back later.
          </p>
        </div>
      )}
    </div>
  );
};

export default Vehicles;
