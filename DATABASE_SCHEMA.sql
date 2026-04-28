-- Car Hire Tracking System Database Schema
-- PostgreSQL 14+

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- Users table with role-based access
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'customer')),
    driver_license VARCHAR(50),
    address TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);

-- Vehicle categories
CREATE TABLE vehicle_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    daily_rate DECIMAL(10,2) NOT NULL,
    hourly_rate DECIMAL(10,2) NOT NULL,
    per_km_rate DECIMAL(10,2) NOT NULL
);

-- Vehicles fleet
CREATE TABLE vehicles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    make VARCHAR(100) NOT NULL,
    model VARCHAR(100) NOT NULL,
    year INTEGER NOT NULL,
    license_plate VARCHAR(20) UNIQUE NOT NULL,
    vin VARCHAR(50) UNIQUE,
    category_id INTEGER REFERENCES vehicle_categories(id),
    status VARCHAR(20) NOT NULL CHECK (status IN ('available', 'booked', 'in_use', 'maintenance', 'offline')),
    current_latitude DECIMAL(10, 8),
    current_longitude DECIMAL(11, 8),
    last_location_update TIMESTAMP WITH TIME ZONE,
    odometer INTEGER DEFAULT 0,
    fuel_level DECIMAL(5,2) CHECK (fuel_level >= 0 AND fuel_level <= 100),
    last_maintenance DATE,
    next_maintenance_due DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);

-- Geo-fences for monitoring
CREATE TABLE geo_fences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    boundary GEOGRAPHY(POLYGON) NOT NULL,
    fence_type VARCHAR(20) NOT NULL CHECK (fence_type IN ('allowed', 'restricted')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Vehicle to geo-fence associations
CREATE TABLE vehicle_geo_fences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    geo_fence_id UUID REFERENCES geo_fences(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(vehicle_id, geo_fence_id)
);

-- Bookings with concurrency control
CREATE TABLE bookings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID REFERENCES users(id) NOT NULL,
    vehicle_id UUID REFERENCES vehicles(id) NOT NULL,
    pickup_datetime TIMESTAMP WITH TIME ZONE NOT NULL,
    return_datetime TIMESTAMP WITH TIME ZONE NOT NULL,
    actual_pickup_datetime TIMESTAMP WITH TIME ZONE,
    actual_return_datetime TIMESTAMP WITH TIME ZONE,
    pickup_location TEXT,
    dropoff_location TEXT,
    total_cost DECIMAL(10,2),
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'confirmed', 'active', 'completed', 'cancelled')),
    payment_status VARCHAR(20) NOT NULL CHECK (payment_status IN ('pending', 'paid', 'refunded')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Prevent overlapping bookings for the same vehicle
    EXCLUDE USING gist (
        vehicle_id WITH =,
        tstzrange(pickup_datetime, return_datetime) WITH &&
    )
);

-- Trips for tracking actual usage
CREATE TABLE trips (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id UUID REFERENCES bookings(id) NOT NULL,
    vehicle_id UUID REFERENCES vehicles(id) NOT NULL,
    driver_id UUID REFERENCES users(id) NOT NULL,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE,
    start_latitude DECIMAL(10, 8),
    start_longitude DECIMAL(11, 8),
    end_latitude DECIMAL(10, 8),
    end_longitude DECIMAL(11, 8),
    start_odometer INTEGER,
    end_odometer INTEGER,
    distance_km DECIMAL(8,2),
    duration_minutes INTEGER,
    base_cost DECIMAL(10,2),
    distance_cost DECIMAL(10,2),
    time_cost DECIMAL(10,2),
    total_cost DECIMAL(10,2),
    status VARCHAR(20) NOT NULL CHECK (status IN ('active', 'completed', 'cancelled')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Partitioned table for GPS location tracking (time-series data)
CREATE TABLE vehicle_locations (
    id UUID DEFAULT uuid_generate_v4(),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    speed DECIMAL(5,2),
    heading DECIMAL(5,2),
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    location GEOGRAPHY(POINT) GENERATED ALWAYS AS (ST_MAKEPOINT(longitude, latitude)) STORED,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
) PARTITION BY RANGE (timestamp);

-- Create monthly partitions for GPS data
CREATE TABLE vehicle_locations_2024_01 PARTITION OF vehicle_locations
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

CREATE TABLE vehicle_locations_2024_02 PARTITION OF vehicle_locations
    FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');

-- Add more partitions as needed...

-- Alerts and notifications
CREATE TABLE alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id UUID REFERENCES vehicles(id),
    alert_type VARCHAR(50) NOT NULL CHECK (alert_type IN (
        'geo_fence_violation', 'idle_timeout', 'maintenance_due', 
        'low_fuel', 'unauthorized_use', 'gps_error'
    )),
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    message TEXT NOT NULL,
    is_resolved BOOLEAN DEFAULT false,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Maintenance records
CREATE TABLE maintenance_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id UUID REFERENCES vehicles(id) NOT NULL,
    maintenance_type VARCHAR(50) NOT NULL,
    description TEXT,
    cost DECIMAL(10,2),
    performed_at DATE NOT NULL,
    performed_by VARCHAR(100),
    next_due_date DATE,
    odometer_reading INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Payment records
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id UUID REFERENCES bookings(id) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    payment_method VARCHAR(50) NOT NULL,
    transaction_id VARCHAR(100),
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
    processed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- System audit log
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    table_name VARCHAR(50),
    record_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Performance indexes
CREATE INDEX idx_vehicles_status ON vehicles(status);
CREATE INDEX idx_vehicles_location ON vehicles(current_latitude, current_longitude);
CREATE INDEX idx_bookings_vehicle_time ON bookings(vehicle_id, tstzrange(pickup_datetime, return_datetime));
CREATE INDEX idx_bookings_customer ON bookings(customer_id);
CREATE INDEX idx_trips_vehicle_time ON trips(vehicle_id, start_time);
CREATE INDEX idx_vehicle_locations_vehicle_time ON vehicle_locations(vehicle_id, timestamp);
CREATE INDEX idx_alerts_vehicle_unresolved ON alerts(vehicle_id, is_resolved) WHERE is_resolved = false;

-- Geo-fence violation detection index
CREATE INDEX idx_vehicle_locations_geo ON vehicle_locations USING gist (location);

-- Trigger for updating audit logs
CREATE OR REPLACE FUNCTION audit_trigger_function()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_logs (action, table_name, record_id, new_values)
        VALUES ('INSERT', TG_TABLE_NAME, NEW.id, row_to_json(NEW));
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_logs (action, table_name, record_id, old_values, new_values)
        VALUES ('UPDATE', TG_TABLE_NAME, NEW.id, row_to_json(OLD), row_to_json(NEW));
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO audit_logs (action, table_name, record_id, old_values)
        VALUES ('DELETE', TG_TABLE_NAME, OLD.id, row_to_json(OLD));
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Apply audit trigger to critical tables
CREATE TRIGGER audit_users AFTER INSERT OR UPDATE OR DELETE ON users
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_vehicles AFTER INSERT OR UPDATE OR DELETE ON vehicles
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_bookings AFTER INSERT OR UPDATE OR DELETE ON bookings
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_trips AFTER INSERT OR UPDATE OR DELETE ON trips
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

-- Function to check for geo-fence violations
CREATE OR REPLACE FUNCTION check_geo_fence_violations()
RETURNS TRIGGER AS $$
DECLARE
    violation_count INTEGER;
    alert_message TEXT;
BEGIN
    -- Check if vehicle is in any restricted geo-fence
    SELECT COUNT(*) INTO violation_count
    FROM geo_fences gf
    JOIN vehicle_geo_fences vgf ON gf.id = vgf.geo_fence_id
    WHERE vgf.vehicle_id = NEW.vehicle_id
    AND gf.fence_type = 'restricted'
    AND gf.is_active = true
    AND ST_Contains(gf.boundary, NEW.location);

    IF violation_count > 0 THEN
        alert_message := format('Vehicle %s entered restricted area at %s', 
                               NEW.vehicle_id, NEW.timestamp);
        
        INSERT INTO alerts (vehicle_id, alert_type, severity, message)
        VALUES (NEW.vehicle_id, 'geo_fence_violation', 'high', alert_message);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for geo-fence checking
CREATE TRIGGER check_geo_fences AFTER INSERT ON vehicle_locations
    FOR EACH ROW EXECUTE FUNCTION check_geo_fence_violations();

-- Function to calculate trip cost
CREATE OR REPLACE FUNCTION calculate_trip_cost(trip_uuid UUID)
RETURNS DECIMAL(10,2) AS $$
DECLARE
    trip_record RECORD;
    base_cost DECIMAL(10,2);
    distance_cost DECIMAL(10,2);
    time_cost DECIMAL(10,2);
    total_cost DECIMAL(10,2);
BEGIN
    SELECT * INTO trip_record FROM trips WHERE id = trip_uuid;
    
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    -- Get vehicle rates
    SELECT vc.daily_rate, vc.hourly_rate, vc.per_km_rate 
    INTO base_cost, time_cost, distance_cost
    FROM vehicles v
    JOIN vehicle_categories vc ON v.category_id = vc.id
    WHERE v.id = trip_record.vehicle_id;

    -- Calculate costs based on actual usage
    IF trip_record.distance_km IS NOT NULL THEN
        distance_cost := trip_record.distance_km * distance_cost;
    END IF;

    IF trip_record.duration_minutes IS NOT NULL THEN
        time_cost := (trip_record.duration_minutes / 60.0) * time_cost;
    END IF;

    total_cost := COALESCE(base_cost, 0) + COALESCE(distance_cost, 0) + COALESCE(time_cost, 0);

    -- Update trip record
    UPDATE trips SET
        base_cost = COALESCE(base_cost, 0),
        distance_cost = COALESCE(distance_cost, 0),
        time_cost = COALESCE(time_cost, 0),
        total_cost = total_cost
    WHERE id = trip_uuid;

    RETURN total_cost;
END;
$$ LANGUAGE plpgsql;

-- Sample data insertion
INSERT INTO vehicle_categories (name, description, daily_rate, hourly_rate, per_km_rate) VALUES
('Economy', 'Compact cars for city driving', 45.00, 8.00, 0.25),
('Standard', 'Mid-size sedans', 65.00, 12.00, 0.35),
('SUV', 'Sport utility vehicles', 85.00, 15.00, 0.45),
('Luxury', 'Premium vehicles', 120.00, 20.00, 0.60);

-- Create admin user (password: admin123)
INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES
('admin@carhire.com', '$2b$10$rOzJqQjQjQjQjQjQjQjQjOzJqQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQjQ', 'System', 'Administrator', 'admin');
