-- Migration 002: Seed data for two distinct test stores (Store A and Store B)

-- 1. Seed Merchants
INSERT INTO merchants (id, name, contact_email) VALUES
    ('11111111-1111-1111-1111-111111111111', 'Eco Threads Ltd', 'ops@london-eco.co.uk'),
    ('22222222-2222-2222-2222-222222222222', 'Highland Peak Gear Ltd', 'support@highlandpeak.co.uk')
ON CONFLICT (id) DO NOTHING;

-- 2. Seed Stores
INSERT INTO stores (id, merchant_id, shop_domain, brand_name, status) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'london-eco.myshopify.com', 'London Eco Apparel', 'active'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'highland-peak.myshopify.com', 'Highland Peak Gear', 'active')
ON CONFLICT (id) DO NOTHING;

-- 3. Seed Widget Settings
INSERT INTO widget_settings (id, store_id, button_text, position, primary_colour, secondary_colour, greeting) VALUES
    ('a1a1a1a1-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Ask Eco Stylist', 'bottom-right', '#2d6a4f', '#ffffff', 'Welcome to London Eco! How can I help you find sustainable organic clothing today?'),
    ('b2b2b2b2-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Ask Mountain Guide', 'bottom-left', '#1d3557', '#f1faee', 'Heading outdoors? Ask me about weather-tested hiking gear and mountain wear.')
ON CONFLICT (id) DO NOTHING;

-- 4. Seed Assistant Settings
INSERT INTO assistant_settings (id, store_id, assistant_name, allowed_topics, support_contact, privacy_policy_url) VALUES
    ('a2a2a2a2-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'EcoStylist AI', ARRAY['product_recommendation', 'organic_materials', 'size_guide', 'sustainable_care'], 'support@london-eco.co.uk', 'https://london-eco.myshopify.com/policies/privacy-policy'),
    ('b3b3b3b3-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'PeakGuide AI', ARRAY['product_recommendation', 'weather_ratings', 'waterproofing', 'gear_sizing'], 'help@highlandpeak.co.uk', 'https://highland-peak.myshopify.com/policies/privacy-policy')
ON CONFLICT (id) DO NOTHING;

-- 5. Seed Store Policies
INSERT INTO store_policies (id, store_id, delivery_policy, returns_policy, faq_content) VALUES
    ('a3a3a3a3-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     'Carbon-neutral UK delivery in 2-3 business days (£3.99, free over £50). Royal Mail tracked.',
     '30-day free eco-returns using prepaid paperless QR code. Items must be unworn with tags attached.',
     'Q: Are all garments certified organic? A: Yes, 100% GOTS certified cotton and recycled wool.'),
    ('b4b4b4b4-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
     'Next-day UK mountain courier (£5.99, free over £100). DPD tracked with 1-hour delivery window.',
     '60-day trial guarantee and lifetime manufacturer warranty against seam or zip defects.',
     'Q: Are jackets waterproof? A: All storm shells feature minimum 20,000mm hydrostatic head rating.')
ON CONFLICT (id) DO NOTHING;

-- 6. Seed Store Credentials (mock encrypted tokens for local test verification)
INSERT INTO store_credentials (id, store_id, encrypted_admin_token, encrypted_storefront_token, encryption_iv) VALUES
    ('a4a4a4a4-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'enc_mock_admin_token_store_a', 'enc_mock_storefront_token_store_a', 'iv_mock_store_a'),
    ('b5b5b5b5-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'enc_mock_admin_token_store_b', 'enc_mock_storefront_token_store_b', 'iv_mock_store_b')
ON CONFLICT (id) DO NOTHING;
