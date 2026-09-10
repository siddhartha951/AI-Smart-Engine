-- Migration 004: Seed Users

-- Note: In a real environment, passwords would be hashed by the application.
-- For these seed tests, we will insert pre-hashed passwords for 'password123'
-- using bcrypt (cost 10). Hash: $2b$10$vtBpjJ0t4.cpwJl4QPHB1uAbHmxoDcbCfATIRgDmPcKGGSeSY3T1a

-- Insert Admin
INSERT INTO users (email, password_hash, role)
VALUES ('admin@platform.com', '$2b$10$vtBpjJ0t4.cpwJl4QPHB1uAbHmxoDcbCfATIRgDmPcKGGSeSY3T1a', 'platform_admin')
ON CONFLICT (email) DO NOTHING;

-- Insert Merchant A
INSERT INTO users (email, password_hash, role, merchant_id, store_id)
VALUES (
    'merchantA@store.com', 
    '$2b$10$vtBpjJ0t4.cpwJl4QPHB1uAbHmxoDcbCfATIRgDmPcKGGSeSY3T1a', 
    'merchant_owner', 
    '11111111-1111-1111-1111-111111111111', 
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
)
ON CONFLICT (email) DO NOTHING;

-- Insert Merchant B
INSERT INTO users (email, password_hash, role, merchant_id, store_id)
VALUES (
    'merchantB@store.com', 
    '$2b$10$vtBpjJ0t4.cpwJl4QPHB1uAbHmxoDcbCfATIRgDmPcKGGSeSY3T1a', 
    'merchant_owner', 
    '22222222-2222-2222-2222-222222222222', 
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
)
ON CONFLICT (email) DO NOTHING;
