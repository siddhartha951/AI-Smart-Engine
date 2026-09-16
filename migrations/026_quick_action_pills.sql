-- Migration 026: Quick Action Pills & Store Navigation Links for Assistant Settings

-- 1. Add quick_action_pills JSONB column to assistant_settings
ALTER TABLE assistant_settings
ADD COLUMN IF NOT EXISTS quick_action_pills JSONB DEFAULT '[]';

-- 2. Backfill existing stores with standard 8 default pills if empty or null
UPDATE assistant_settings
SET quick_action_pills = '[
  {
    "id": "track_order",
    "group": "support",
    "label": "Track My Order",
    "enabled": true,
    "url": "",
    "icon": "📦"
  },
  {
    "id": "return_policy",
    "group": "support",
    "label": "Return & Exchange Policy",
    "enabled": true,
    "url": "",
    "icon": "🔄"
  },
  {
    "id": "shipping_delivery",
    "group": "support",
    "label": "Shipping & Delivery",
    "enabled": true,
    "url": "",
    "icon": "🚚"
  },
  {
    "id": "whatsapp_support",
    "group": "support",
    "label": "WhatsApp / Human Support",
    "enabled": true,
    "url": "",
    "icon": "💬"
  },
  {
    "id": "current_offers",
    "group": "sales",
    "label": "Current Offers & Discounts",
    "enabled": true,
    "url": "",
    "icon": "🏷️"
  },
  {
    "id": "best_sellers",
    "group": "sales",
    "label": "Best Sellers / Trending",
    "enabled": true,
    "url": "",
    "icon": "🔥"
  },
  {
    "id": "size_guide",
    "group": "sales",
    "label": "Size Guide & Fit Help",
    "enabled": true,
    "url": "",
    "image_url": "",
    "icon": "📏"
  },
  {
    "id": "gift_ideas",
    "group": "sales",
    "label": "Gift Ideas & Collections",
    "enabled": true,
    "url": "",
    "icon": "🎁"
  }
]'::jsonb
WHERE quick_action_pills IS NULL OR quick_action_pills = '[]'::jsonb;
