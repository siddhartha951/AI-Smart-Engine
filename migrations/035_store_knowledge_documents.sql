-- Merchant-supplied knowledge (uploaded PDFs, docs, FAQs) kept separately from the
-- website-scan knowledge_base blob, so a rescan can never overwrite it.
CREATE TABLE IF NOT EXISTS store_knowledge_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    document_type VARCHAR(20) NOT NULL DEFAULT 'text',
    content TEXT NOT NULL,
    char_count INT NOT NULL DEFAULT 0,
    truncated BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_store_knowledge_documents_store ON store_knowledge_documents(store_id, created_at);
