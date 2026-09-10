(function () {
  const SCRIPT_ID = 'ai-shopping-assistant-script';
  
  function detectBaseUrl() {
    if (window.AI_ASSISTANT_API_BASE) return window.AI_ASSISTANT_API_BASE;
    const script = document.currentScript || 
                   document.querySelector('script[data-widget-key]') || 
                   document.querySelector('script[data-store-id]') || 
                   document.querySelector('script[src*="widget.js"]');
    if (script && script.src) {
      try {
        const url = new URL(script.src);
        return url.origin;
      } catch (_) {}
    }
    return 'http://localhost:3000';
  }
  const API_BASE_URL = detectBaseUrl();

  function buildUtmProductUrl(productUrl, sessionId, visitorId, storeId) {
    if (!productUrl || productUrl === '#') return '#';
    try {
      const url = new URL(productUrl, window.location.origin);
      url.searchParams.set('utm_source', 'ai_smart_engine');
      url.searchParams.set('utm_medium', 'shopping_assistant');
      url.searchParams.set('utm_campaign', 'ai_recommendation');
      if (sessionId) url.searchParams.set('ai_sid', sessionId);
      if (visitorId) url.searchParams.set('ai_vid', visitorId);
      if (storeId) url.searchParams.set('ai_store', storeId);
      return url.toString();
    } catch (_) {
      const sep = productUrl.includes('?') ? '&' : '?';
      return `${productUrl}${sep}utm_source=ai_smart_engine&utm_medium=shopping_assistant&utm_campaign=ai_recommendation&ai_sid=${sessionId || ''}&ai_vid=${visitorId || ''}`;
    }
  }

  function formatCurrencyPrice(amount, currencyCode) {
    if (amount === undefined || amount === null || amount === '') return '';
    const code = (currencyCode || 'INR').toUpperCase();
    const symbolMap = {
      INR: '₹',
      USD: '$',
      EUR: '€',
      GBP: '£',
      AED: 'AED ',
      CAD: 'CA$',
      AUD: 'AU$',
      SGD: 'SG$',
      JPY: '¥',
      SAR: 'SAR '
    };
    const symbol = symbolMap[code] || (code + ' ');
    return `${symbol}${amount}`;
  }

  async function syncShopifyCartAttributes(sessionId, visitorId) {
    try {
      if (!window.location.hostname.includes('myshopify.com') && !window.Shopify) {
        return;
      }
      await fetch('/cart/update.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          attributes: {
            '_ai_session_id': sessionId || '',
            '_ai_visitor_id': visitorId || '',
            'utm_source': 'ai_smart_engine',
            'utm_medium': 'shopping_assistant',
            'utm_campaign': 'ai_recommendation'
          }
        })
      });
    } catch (_) {}
  }

  function extractProductsFromMarkdown(content) {
    if (!content) return { cleanText: '', cards: [] };
    const cards = [];
    const imgRegex = /!\[([^\]]*)\]\((https?:\/\/[^\s\)]+)\)/g;
    const linkRegex = /\[(?:View Product|Check out|Buy now|Product)[^\]]*\]\((https?:\/\/[^\s\)]+)\)/gi;
    const priceRegex = /Price:\s*(?:₹|INR|Rs\.?|\$|£|€)?\s*(\d+(?:\.\d+)?)/i;

    let imgMatch;
    while ((imgMatch = imgRegex.exec(content)) !== null) {
      const title = imgMatch[1] || 'Product';
      const imgUrl = imgMatch[2];
      let prodUrl = '#';
      const linkMatch = linkRegex.exec(content);
      if (linkMatch) {
        prodUrl = linkMatch[1];
      }
      const priceMatch = content.match(priceRegex);
      const price = priceMatch ? parseFloat(priceMatch[1]) : 0;
      const currency = content.includes('₹') ? '₹' : (content.includes('£') ? '£' : (content.includes('$') ? '$' : 'INR'));

      cards.push({
        title,
        image_url: imgUrl,
        product_url: prodUrl,
        price,
        currency,
        in_stock: true
      });
    }

    const cleanText = content
      .replace(/!\[.*?\]\(.*?\)/g, '')
      .replace(/\[(?:View Product|Check out|Buy now|Product).*?\]\(.*?\)/gi, '')
      .replace(/-\s*Price:\s*[^-\n]+/gi, '')
      .replace(/\n\s*-\s*\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return { cleanText, cards };
  }

  class ShoppingAssistantWidget extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });

      this.sessionId = null;
      this.visitorId = null;
      this.widgetKey = null;
      this.storeId = null;
      
      this.state = {
        isOpen: false,
        view: 'welcome', // 'welcome', 'lead-capture', 'chat'
        config: null,
        messages: []
      };
    }

    getHeaders(extra = {}) {
      const headers = { ...extra };
      if (this.widgetKey) {
        headers['X-Widget-Key'] = this.widgetKey;
      }
      if (this.storeId) {
        headers['X-Store-ID'] = this.storeId;
        if (!headers['X-Widget-Key']) {
          headers['X-Widget-Key'] = this.storeId;
        }
      }
      return headers;
    }

    async connectedCallback() {
      this.widgetKey = this.getAttribute('data-widget-key') || '';
      this.storeId = this.getAttribute('data-store-id') || this.widgetKey;

      if (!this.widgetKey && !this.storeId) {
        const script = document.querySelector('script[data-widget-key]') || document.querySelector('script[data-store-id]');
        if (script) {
          this.widgetKey = script.getAttribute('data-widget-key') || '';
          this.storeId = script.getAttribute('data-store-id') || this.widgetKey;
        }
      }
      
      if (!this.widgetKey && !this.storeId) {
        console.error('AI Shopping Assistant: Missing data-widget-key or data-store-id attribute');
        return;
      }

      // Restore previously saved session and chat history if active
      try {
        const savedSid = sessionStorage.getItem('ai_session_id') || localStorage.getItem('ai_session_id');
        const savedVid = sessionStorage.getItem('ai_visitor_id') || localStorage.getItem('ai_visitor_id');
        if (savedSid) this.sessionId = savedSid;
        if (savedVid) this.visitorId = savedVid;

        const savedMsgs = sessionStorage.getItem('ai_chat_messages');
        const savedView = sessionStorage.getItem('ai_widget_view');
        const savedOpen = sessionStorage.getItem('ai_widget_open');

        if (savedMsgs) {
          try {
            const parsed = JSON.parse(savedMsgs);
            if (Array.isArray(parsed) && parsed.length > 0) {
              this.state.messages = parsed;
              this.state.view = 'chat';
            }
          } catch (_) {}
        }

        if (savedView && savedView !== 'welcome') {
          this.state.view = savedView;
        }
        if (savedOpen === 'true') {
          this.state.isOpen = true;
        }

        if (savedSid && savedVid) {
          syncShopifyCartAttributes(savedSid, savedVid);
        }

        if (savedSid && (!this.state.messages || this.state.messages.length === 0)) {
          this.loadChatHistory(savedSid);
        }
      } catch (_) {}
      
      this.renderInit();
      await this.loadConfig();
      if (!this.state.config) {
        this.state.config = {
          widget: {
            button_text: 'Shopping Assistant',
            position: 'bottom-right',
            primary_colour: '#1a1a1a',
            secondary_colour: '#ffffff',
            greeting: 'Hi there! Looking for recommendations today?'
          },
          assistant: {
            assistant_name: 'Shopping Assistant',
            is_active: false
          }
        };
      }
      this.render();

      // Full-Store Auto-Tracking & Telemetry
      const isTrackingEnabled = this.state.config?.features?.live_tracking_enabled !== false;
      if (isTrackingEnabled) {
        // Auto-create anonymous session if none exists
        if (!this.sessionId || !this.visitorId) {
          const anonymousId = 'anon_' + Math.random().toString(36).substr(2, 9);
          await this.startSession(anonymousId);
        }

        // Fire instant page_view on landing
        if (this.visitorId) {
          const lastPv = sessionStorage.getItem('ai_last_pv');
          if (lastPv !== window.location.pathname) {
            this.trackEvent('page_view', {
              path: window.location.pathname,
              title: document.title,
              referrer: document.referrer || '',
              source: 'storefront'
            });
            try { sessionStorage.setItem('ai_last_pv', window.location.pathname); } catch (_) {}
          }
          this.initHeartbeat();
        }
      } else {
        console.log('AI Smart Engine: Storefront live tracking is deactivated by administrator.');
      }
    }

    initHeartbeat() {
      if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
      if (this.state.config?.features?.live_tracking_enabled === false) return;
      this._heartbeatTimer = setInterval(() => {
        if (!document.hidden && this.visitorId) {
          this.trackEvent('heartbeat', {
            path: window.location.pathname,
            title: document.title
          });
        }
      }, 90000);
    }

    disconnectedCallback() {
      if (this._heartbeatTimer) {
        clearInterval(this._heartbeatTimer);
        this._heartbeatTimer = null;
      }
    }

    async trackEvent(type, payload = {}) {
      if (!this.visitorId) return;
      if (this.state.config?.features?.live_tracking_enabled === false && (type === 'page_view' || type === 'heartbeat')) {
        return;
      }
      try {
        await fetch(`${API_BASE_URL}/api/v1/widget/events`, {
          method: 'POST',
          headers: this.getHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            widget_key: this.widgetKey || this.storeId,
            visitor_id: this.visitorId,
            session_id: this.sessionId,
            type,
            payload
          })
        });
      } catch (_) {}
    }

    async loadConfig() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/widget/config`, {
          headers: this.getHeaders()
        });
        const json = await res.json();
        if (json.success) {
          this.state.config = json.data;
        } else {
          console.error('AI Assistant config error', json);
        }
      } catch (err) {
        console.error('AI Assistant failed to load config', err);
      }
    }

    async startSession(anonymousId) {
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/widget/session`, {
          method: 'POST',
          headers: this.getHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ anonymous_id: anonymousId })
        });
        const json = await res.json();
        if (json.success) {
          this.sessionId = json.data.session_id;
          this.visitorId = json.data.visitor_id;
          try {
            sessionStorage.setItem('ai_session_id', this.sessionId);
            sessionStorage.setItem('ai_visitor_id', this.visitorId);
            localStorage.setItem('ai_session_id', this.sessionId);
            localStorage.setItem('ai_visitor_id', this.visitorId);
            syncShopifyCartAttributes(this.sessionId, this.visitorId);
          } catch (_) {}
          this.initHeartbeat();
        }
      } catch (err) {
        console.error('Failed to start session', err);
      }
    }

    async submitConsent(email, phone, marketingOptedIn) {
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/widget/visitor/consent`, {
          method: 'POST',
          headers: this.getHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            visitor_id: this.visitorId,
            email,
            phone,
            marketing_opted_in: marketingOptedIn,
            wording: 'I consent to receive shopping assistance and emails.',
            version: '1.0',
            source: 'widget_v1'
          })
        });
        const json = await res.json();
        if (json.success) {
          if (marketingOptedIn) {
            this.trackEvent('marketing_opted_in');
          }
          this.trackEvent('email_submitted', { email });
          const greeting = this.state.config?.widget?.greeting || 'Hello! How can I help you today?';
          this.setState({ 
            view: 'chat',
            messages: [{ role: 'assistant', content: greeting }] 
          });
        } else {
          alert('Error saving details: ' + (json.error?.message || 'Unknown error'));
        }
      } catch (err) {
        console.error('Failed to submit consent', err);
      }
    }

    async sendMessage(text) {
      if (!text.trim()) return;

      // Add user message to state immediately
      const newMessages = [...this.state.messages, { role: 'user', content: text }];
      this.setState({ messages: newMessages });

      // Add loading state
      this.setState({ messages: [...newMessages, { role: 'assistant', content: '...', isLoading: true }] });

      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/widget/chat/message`, {
          method: 'POST',
          headers: this.getHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            session_id: this.sessionId,
            message: text
          })
        });

        const json = await res.json();
        
        // Remove loading state and add real response
        const updatedMessages = [...this.state.messages];
        // replace the loading message at the end
        updatedMessages[updatedMessages.length - 1] = {
          role: 'assistant',
          content: json.success ? json.data.message : 'Error: ' + json.error.message,
          recommendations: json.success ? json.data.recommendations : []
        };
        
        this.setState({ messages: updatedMessages });
      } catch (err) {
        console.error('Chat error', err);
        const updatedMessages = [...this.state.messages];
        updatedMessages[updatedMessages.length - 1] = {
          role: 'assistant',
          content: 'Sorry, I encountered a network error. Please try again.'
        };
        this.setState({ messages: updatedMessages });
      }
    }

    async loadChatHistory(sessionId) {
      if (!sessionId) return;
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/widget/chat/history?session_id=${sessionId}`, {
          headers: this.getHeaders()
        });
        const json = await res.json();
        if (json.success && json.data?.messages && json.data.messages.length > 0) {
          const recs = json.data.recommendations || [];
          const formatted = json.data.messages.map((m, idx) => ({
            role: m.role,
            content: m.content,
            recommendations: m.role === 'assistant' && idx === json.data.messages.length - 1 ? recs : []
          }));
          this.setState({ messages: formatted, view: 'chat' });
        }
      } catch (_) {}
    }

    setState(newState) {
      this.state = { ...this.state, ...newState };
      try {
        if (this.state.messages && this.state.messages.length > 0) {
          sessionStorage.setItem('ai_chat_messages', JSON.stringify(this.state.messages));
        }
        sessionStorage.setItem('ai_widget_view', this.state.view || 'welcome');
        sessionStorage.setItem('ai_widget_open', this.state.isOpen ? 'true' : 'false');
      } catch (_) {}
      this.render();
      
      // Auto scroll to bottom if in chat view
      if (this.state.view === 'chat') {
        setTimeout(() => {
          const chatMessages = this.shadowRoot.querySelector('.chat-messages');
          if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
        }, 50);
      }
    }

    getStyles() {
      const primaryColor = this.state.config?.widget?.primary_colour || '#000000';
      const secondaryColor = this.state.config?.widget?.secondary_colour || '#ffffff';
      
      return `
        :host {
          all: initial; /* CSS Reset */
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        
        #widget-container {
          position: fixed;
          bottom: 20px;
          right: 20px;
          z-index: 999999;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
        }
        
        #launcher {
          background-color: ${primaryColor};
          color: ${secondaryColor};
          border: none;
          border-radius: 50px;
          padding: 12px 24px;
          font-size: 15px;
          font-weight: bold;
          cursor: pointer;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          transition: transform 0.2s ease;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .header-title-container {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .header-avatar {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          object-fit: cover;
          border: 2px solid rgba(255, 255, 255, 0.7);
          box-shadow: 0 2px 4px rgba(0,0,0,0.15);
        }

        .launcher-avatar {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          object-fit: cover;
          border: 2px solid rgba(255, 255, 255, 0.7);
        }

        /* Custom Merchant CSS overrides */
        ${this.state.config?.widget?.custom_css || ''}
        
        #launcher:hover {
          transform: scale(1.05);
        }
        
        #popup {
          width: 350px;
          height: 500px;
          background-color: #fff;
          border-radius: 12px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.2);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          margin-bottom: 16px;
          border: 1px solid #eaeaea;
          opacity: 0;
          pointer-events: none;
          transform: translateY(20px);
          transition: all 0.3s ease;
        }
        
        #popup.open {
          opacity: 1;
          pointer-events: auto;
          transform: translateY(0);
        }
        
        .header {
          background-color: ${primaryColor};
          color: ${secondaryColor};
          padding: 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-weight: bold;
        }
        
        .close-btn {
          background: transparent;
          border: none;
          color: ${secondaryColor};
          cursor: pointer;
          font-size: 20px;
          padding: 0;
        }
        
        .content {
          flex: 1;
          padding: 20px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          color: #333;
        }
        
        h3 {
          margin-top: 0;
          font-size: 18px;
          color: #111;
        }
        
        p {
          font-size: 14px;
          line-height: 1.5;
          margin-bottom: 20px;
        }
        
        .form-group {
          margin-bottom: 16px;
        }
        
        label {
          display: block;
          font-size: 12px;
          font-weight: bold;
          margin-bottom: 6px;
          color: #555;
        }
        
        input[type="email"],
        input[type="tel"] {
          width: 100%;
          padding: 10px;
          border: 1px solid #ccc;
          border-radius: 6px;
          font-size: 14px;
          box-sizing: border-box;
        }
        
        .checkbox-group {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin-bottom: 20px;
        }
        
        .checkbox-group input {
          margin-top: 3px;
        }
        
        .checkbox-group label {
          font-weight: normal;
          margin-bottom: 0;
          font-size: 13px;
        }
        
        .btn {
          background-color: ${primaryColor};
          color: ${secondaryColor};
          border: none;
          border-radius: 6px;
          padding: 12px;
          font-size: 14px;
          font-weight: bold;
          cursor: pointer;
          width: 100%;
          text-align: center;
        }
        
        .btn:hover {
          opacity: 0.9;
        }
        
        .policy-link {
          font-size: 11px;
          color: #777;
          text-align: center;
          margin-top: 12px;
        }
        
        .chat-area {
          display: flex;
          flex-direction: column;
          height: 100%;
        }
        
        .chat-messages {
          flex: 1;
          padding-bottom: 10px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        
        .msg {
          padding: 10px 14px;
          border-radius: 12px;
          font-size: 14px;
          max-width: 85%;
        }
        
        .msg.assistant {
          background-color: #f1f1f1;
          align-self: flex-start;
          border-bottom-left-radius: 2px;
        }
        
        .msg.user {
          background-color: ${primaryColor};
          color: ${secondaryColor};
          align-self: flex-end;
          border-bottom-right-radius: 2px;
        }
        
        .chat-input {
          display: flex;
          border-top: 1px solid #eaeaea;
          padding-top: 10px;
        }
        
        .chat-input input {
          flex: 1;
          border: 1px solid #ccc;
          border-radius: 20px;
          padding: 10px 14px;
          outline: none;
        }
        
        .chat-input button {
          background: transparent;
          border: none;
          color: ${primaryColor};
          font-weight: bold;
          cursor: pointer;
          padding: 0 10px;
        }
        
        .chat-input button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .product-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 10px;
        }

        .product-cards-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 10px;
          width: 100%;
        }

        .product-card {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          overflow: hidden;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
          display: flex;
          flex-direction: column;
        }

        .product-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 18px rgba(0, 0, 0, 0.08);
          border-color: #cbd5e1;
        }

        .product-card-thumb-wrap {
          position: relative;
          width: 100%;
          height: 140px;
          background: #f1f5f9;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .product-card-thumb {
          width: 100%;
          height: 100%;
          object-fit: cover;
          transition: transform 0.3s ease;
        }

        .product-card:hover .product-card-thumb {
          transform: scale(1.04);
        }

        .product-badge-stock {
          position: absolute;
          top: 8px;
          right: 8px;
          background: #10b981;
          color: #ffffff;
          font-size: 10px;
          font-weight: 700;
          padding: 2px 7px;
          border-radius: 12px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.15);
        }

        .product-badge-out {
          position: absolute;
          top: 8px;
          right: 8px;
          background: #ef4444;
          color: #ffffff;
          font-size: 10px;
          font-weight: 700;
          padding: 2px 7px;
          border-radius: 12px;
          text-transform: uppercase;
          box-shadow: 0 2px 4px rgba(0,0,0,0.15);
        }

        .product-card-info {
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .product-card-title {
          font-size: 13px;
          font-weight: 700;
          color: #0f172a;
          margin: 0;
          line-height: 1.35;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .product-card-price-row {
          display: flex;
          align-items: baseline;
          gap: 4px;
        }

        .product-card-price {
          font-size: 15px;
          font-weight: 800;
          color: #047857;
        }

        .product-card-btn-group {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          margin-top: 4px;
        }

        .btn-view-product {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 7px 10px;
          background: #f8fafc;
          color: #334155;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 600;
          text-decoration: none;
          transition: all 0.15s;
          cursor: pointer;
        }

        .btn-view-product:hover {
          background: #e2e8f0;
          color: #0f172a;
          text-decoration: none;
        }

        .btn-add-to-cart {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 7px 10px;
          background: ${primaryColor};
          color: ${secondaryColor};
          border: none;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
        }

        .btn-add-to-cart:hover {
          opacity: 0.9;
        }

        .btn-add-to-cart.added {
          background: #10b981 !important;
          color: #ffffff !important;
        }
        
        /* Mobile behavior */
        @media (max-width: 480px) {
          #widget-container {
            bottom: 10px;
            right: 10px;
          }
          #popup {
            width: calc(100vw - 20px);
            height: calc(100vh - 80px);
            max-height: 600px;
          }
        }
      `;
    }

    renderInit() {
      this.shadowRoot.innerHTML = `
        <style>
          :host { all: initial; }
          #launcher { display: none; }
        </style>
        <div id="widget-container"></div>
      `;
    }

    render() {
      const { widget: widgetConfig, assistant: assistantConfig } = this.state.config || {};
      
      const buttonText = widgetConfig?.button_text || 'Ask our shopping assistant';
      const greeting = widgetConfig?.greeting || 'Hello! How can I help you today?';
      const assistantName = assistantConfig?.assistant_name || 'Assistant';
      const headerTitle = widgetConfig?.header_title || assistantName;
      const avatarUrl = widgetConfig?.avatar_url || '';
      const policyUrl = assistantConfig?.privacy_policy_url || '#';

      const avatarHeaderHtml = avatarUrl ? `<img src="${avatarUrl}" class="header-avatar" alt="Avatar" />` : '';
      const avatarLauncherHtml = avatarUrl ? `<img src="${avatarUrl}" class="launcher-avatar" alt="Avatar" />` : '';

      this.shadowRoot.innerHTML = `
        <style>${this.getStyles()}</style>
        <div id="widget-container">
          <div id="popup" class="${this.state.isOpen ? 'open' : ''}">
            <div class="header">
              <div class="header-title-container">
                ${avatarHeaderHtml}
                <span>${headerTitle}</span>
              </div>
              <button class="close-btn">&times;</button>
            </div>
            
            <div class="content">
              ${this.renderView(greeting, policyUrl)}
            </div>
          </div>
          
          <button id="launcher">
            ${avatarLauncherHtml}
            <span>${this.state.isOpen ? 'Close' : buttonText}</span>
          </button>
        </div>
      `;

      this.attachEventListeners();
    }

    renderView(greeting, policyUrl) {
      if (this.state.view === 'welcome') {
        return `
          <h3>Welcome!</h3>
          <p>${greeting}</p>
          <button class="btn" id="btn-start">Get Started</button>
        `;
      } 
      
      if (this.state.view === 'lead-capture') {
        return `
          <h3>Let's get started</h3>
          <p>Please provide your email to continue. This helps us save your recommendations.</p>
          
          <form id="lead-form">
            <div class="form-group">
              <label for="email">Email Address (Required)</label>
              <input type="email" id="email" required placeholder="you@example.com" />
            </div>
            
            <div class="form-group">
              <label for="phone">Phone Number (Optional)</label>
              <input type="tel" id="phone" placeholder="+44 7000 000000" />
            </div>
            
            <div class="checkbox-group">
              <input type="checkbox" id="marketing" />
              <label for="marketing">
                Keep me updated with news and exclusive offers. I understand I can unsubscribe at any time.
              </label>
            </div>
            
            <button type="submit" class="btn">Continue to Chat</button>
          </form>
          
          <div class="policy-link">
            <a href="${policyUrl}" target="_blank">Privacy Policy</a>
          </div>
        `;
      }
      
      if (this.state.view === 'chat') {
        const messagesHtml = this.state.messages.map(m => {
          let recs = Array.isArray(m.recommendations) ? [...m.recommendations] : [];
          let displayText = m.content || '';

          // If recommendations are empty, parse potential markdown from legacy/streaming messages
          if (recs.length === 0 && displayText.includes('http')) {
            const extracted = extractProductsFromMarkdown(displayText);
            if (extracted.cards.length > 0) {
              recs = extracted.cards;
              displayText = extracted.cleanText;
            }
          }

          let recsHtml = '';
          if (recs.length > 0) {
            recsHtml = '<div class="product-cards-list">' + recs.map(r => {
              const rawPrice = r.price !== undefined ? r.price : '';
              const priceDisplay = formatCurrencyPrice(rawPrice, r.currency);
              const trackingUrl = buildUtmProductUrl(r.product_url, this.sessionId, this.visitorId, this.storeId);
              const inStock = r.in_stock !== false;
              const imgUrl = r.image_url || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&q=80';

              return `
                <div class="product-card">
                  <div class="product-card-thumb-wrap">
                    <img src="${imgUrl}" alt="${r.title || 'Product'}" class="product-card-thumb" loading="lazy" />
                    <span class="${inStock ? 'product-badge-stock' : 'product-badge-out'}">
                      ${inStock ? 'In Stock' : 'Out of Stock'}
                    </span>
                  </div>
                  <div class="product-card-info">
                    <h4 class="product-card-title" title="${r.title || ''}">${r.title || 'Product'}</h4>
                    <div class="product-card-price-row">
                      <span class="product-card-price">${priceDisplay}</span>
                    </div>
                    <div class="product-card-btn-group">
                      <a href="${trackingUrl}" target="_blank" class="btn-view-product" 
                         data-product-id="${r.product_id || r.productId || ''}" 
                         data-title="${encodeURIComponent(r.title || '')}"
                         data-url="${encodeURIComponent(trackingUrl)}">
                        View Product ↗
                      </a>
                      <button type="button" class="btn-add-to-cart" 
                              data-variant-id="${r.variant_id || r.variantId || ''}" 
                              data-product-id="${r.product_id || r.productId || ''}" 
                              data-title="${encodeURIComponent(r.title || '')}" 
                              data-price="${rawPrice}" 
                              data-currency="${r.currency || 'INR'}"
                              data-product-url="${encodeURIComponent(trackingUrl)}">
                        Add to Cart 🛒
                      </button>
                    </div>
                  </div>
                </div>
              `;
            }).join('') + '</div>';
          }

          return `
            <div class="msg ${m.role}">
              <div class="msg-text">${displayText}</div>
              ${recsHtml}
            </div>
          `;
        }).join('');

        const isWaiting = this.state.messages.length > 0 && this.state.messages[this.state.messages.length - 1].isLoading;

        return `
          <div class="chat-area">
            <div class="chat-messages" style="overflow-y: auto;">
              ${messagesHtml}
            </div>
            <form class="chat-input" id="chat-form">
              <input type="text" id="chat-input-text" placeholder="Type a message..." ${isWaiting ? 'disabled' : ''} autocomplete="off" />
              <button type="submit" ${isWaiting ? 'disabled' : ''}>Send</button>
            </form>
          </div>
        `;
      }
    }

    attachEventListeners() {
      const launcher = this.shadowRoot.getElementById('launcher');
      const closeBtn = this.shadowRoot.querySelector('.close-btn');
      
      if (launcher) {
        launcher.addEventListener('click', () => {
          const nextState = !this.state.isOpen;
          this.setState({ isOpen: nextState });
          if (nextState) {
            this.trackEvent('widget_opened');
          }
        });
      }
      
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          this.setState({ isOpen: false });
        });
      }

      const btnStart = this.shadowRoot.getElementById('btn-start');
      if (btnStart) {
        btnStart.addEventListener('click', async () => {
          const anonymousId = 'anon_' + Math.random().toString(36).substr(2, 9);
          await this.startSession(anonymousId);
          this.setState({ view: 'lead-capture' });
        });
      }

      const leadForm = this.shadowRoot.getElementById('lead-form');
      if (leadForm) {
        leadForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const email = this.shadowRoot.getElementById('email').value;
          const phone = this.shadowRoot.getElementById('phone').value;
          const marketingOptedIn = this.shadowRoot.getElementById('marketing').checked;
          
          const submitBtn = leadForm.querySelector('button[type="submit"]');
          submitBtn.disabled = true;
          submitBtn.textContent = 'Saving...';
          
          await this.submitConsent(email, phone, marketingOptedIn);
        });
      }

      const chatForm = this.shadowRoot.getElementById('chat-form');
      if (chatForm) {
        chatForm.addEventListener('submit', (e) => {
          e.preventDefault();
          const input = this.shadowRoot.getElementById('chat-input-text');
          const text = input.value;
          if (text) {
            input.value = '';
            this.sendMessage(text);
          }
        });
        
        // Focus input on load
        setTimeout(() => {
          const input = this.shadowRoot.getElementById('chat-input-text');
          if (input && !input.disabled) {
            input.focus();
          }
        }, 100);
      }

      // Attach click events for product card "View Product" buttons
      this.shadowRoot.querySelectorAll('.btn-view-product').forEach(btn => {
        btn.addEventListener('click', () => {
          const prodId = btn.getAttribute('data-product-id');
          const title = decodeURIComponent(btn.getAttribute('data-title') || '');
          const url = decodeURIComponent(btn.getAttribute('data-url') || '');
          this.trackEvent('product_click', {
            product_id: prodId,
            title,
            url,
            utm_source: 'ai_smart_engine',
            utm_medium: 'shopping_assistant',
            utm_campaign: 'ai_recommendation'
          });
          syncShopifyCartAttributes(this.sessionId, this.visitorId);
        });
      });

      // Attach click events for product card "Add to Cart" buttons
      this.shadowRoot.querySelectorAll('.btn-add-to-cart').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          const rawVarId = btn.getAttribute('data-variant-id') || '';
          const cleanVariantId = rawVarId.replace(/^.*\/ProductVariant\//, '').trim();
          const prodId = btn.getAttribute('data-product-id');
          const title = decodeURIComponent(btn.getAttribute('data-title') || '');
          const price = btn.getAttribute('data-price');
          const currency = btn.getAttribute('data-currency');
          const productUrl = decodeURIComponent(btn.getAttribute('data-product-url') || '');

          btn.disabled = true;
          btn.textContent = 'Adding...';

          // 1. Sync cart note attributes to Shopify cart
          await syncShopifyCartAttributes(this.sessionId, this.visitorId);

          let addedToShopify = false;
          // 2. Add item to Shopify cart if on storefront
          if (cleanVariantId) {
            try {
              const cartRes = await fetch('/cart/add.js', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({
                  id: cleanVariantId,
                  quantity: 1,
                  properties: {
                    '_ai_recommended': 'true',
                    '_ai_session_id': this.sessionId || ''
                  }
                })
              });
              if (cartRes.ok) {
                addedToShopify = true;
                document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
                document.dispatchEvent(new CustomEvent('cart:updated', { bubbles: true }));
                try {
                  const drawerTrigger = document.querySelector('[data-ajax-cart-trigger], .cart-drawer-trigger, #cart-icon-bubble, .header__icon--cart');
                  if (drawerTrigger) drawerTrigger.click();
                } catch (_) {}
              } else {
                console.warn('Shopify /cart/add.js returned non-ok', await cartRes.text());
              }
            } catch (err) {
              console.warn('Error calling /cart/add.js', err);
            }
          }

          // 3. Track event in backend
          await this.trackEvent('add_to_cart', {
            product_id: prodId,
            variant_id: cleanVariantId,
            title,
            price: parseFloat(price) || 0,
            currency: currency || 'INR',
            utm_source: 'ai_smart_engine',
            utm_medium: 'shopping_assistant',
            utm_campaign: 'ai_recommendation'
          });

          // 4. Update button UI or fallback
          if (addedToShopify) {
            btn.classList.add('added');
            btn.textContent = 'Added ✓ (View Cart)';
            btn.disabled = false;
            btn.onclick = () => { window.location.href = '/cart'; };
            setTimeout(() => {
              btn.classList.remove('added');
              btn.textContent = 'Add to Cart 🛒';
            }, 3500);
          } else if (productUrl && productUrl !== '#') {
            btn.textContent = 'Opening Product...';
            window.location.href = productUrl;
          } else {
            btn.classList.add('added');
            btn.textContent = 'Added ✓';
            setTimeout(() => {
              btn.classList.remove('added');
              btn.disabled = false;
              btn.textContent = 'Add to Cart 🛒';
            }, 2000);
          }
        });
      });
    }
  }

  customElements.define('ai-shopping-assistant', ShoppingAssistantWidget);

  // Auto-mount into document.body when imported via <script src="..." data-widget-key="...">
  function autoMountWidget() {
    if (document.querySelector('ai-shopping-assistant')) return;
    const script = document.currentScript || 
                   document.querySelector('script[data-widget-key]') || 
                   document.querySelector('script[data-store-id]') ||
                   document.querySelector('script[src*="widget.js"]');
    if (!script) return;
    const widgetKey = script.getAttribute('data-widget-key');
    const storeId = script.getAttribute('data-store-id');
    if (widgetKey || storeId) {
      const el = document.createElement('ai-shopping-assistant');
      if (widgetKey) el.setAttribute('data-widget-key', widgetKey);
      if (storeId) el.setAttribute('data-store-id', storeId);
      document.body.appendChild(el);
    }
  }

  // Storefront attribution listener & cart attributes sync
  function hookStorefrontCartEvents() {
    try {
      const params = new URLSearchParams(window.location.search);
      const aiSid = params.get('ai_sid');
      const aiVid = params.get('ai_vid');
      const utmSource = params.get('utm_source');
      if (aiSid) {
        sessionStorage.setItem('ai_session_id', aiSid);
        localStorage.setItem('ai_session_id', aiSid);
      }
      if (aiVid) {
        sessionStorage.setItem('ai_visitor_id', aiVid);
        localStorage.setItem('ai_visitor_id', aiVid);
      }
      if (utmSource) {
        sessionStorage.setItem('ai_utm_source', utmSource);
      }

      const activeSid = aiSid || sessionStorage.getItem('ai_session_id') || localStorage.getItem('ai_session_id');
      const activeVid = aiVid || sessionStorage.getItem('ai_visitor_id') || localStorage.getItem('ai_visitor_id');
      if (activeSid && activeVid) {
        syncShopifyCartAttributes(activeSid, activeVid);
      }

      // Intercept storefront fetch calls to /cart/add or /cart/add.js
      const origFetch = window.fetch;
      if (origFetch) {
        window.fetch = async function (...args) {
          const res = await origFetch.apply(this, args);
          try {
            const url = args[0] ? (typeof args[0] === 'string' ? args[0] : args[0].url) : '';
            if (url && (url.includes('/cart/add') || url.includes('/cart/add.js'))) {
              const sid = sessionStorage.getItem('ai_session_id') || localStorage.getItem('ai_session_id');
              const vid = sessionStorage.getItem('ai_visitor_id') || localStorage.getItem('ai_visitor_id');
              if (sid && vid) {
                syncShopifyCartAttributes(sid, vid);
              }

              // Emit add_to_cart event for live activity ticker
              try {
                const widgetEl = document.querySelector('ai-shopping-assistant');
                if (widgetEl && typeof widgetEl.trackEvent === 'function') {
                  const clone = res.clone();
                  clone.json().then(item => {
                    widgetEl.trackEvent('add_to_cart', {
                      title: item.title || item.product_title || 'Storefront Item',
                      price: item.price ? (item.price / 100).toFixed(2) : undefined,
                      currency: item.currency || 'INR',
                      source: 'storefront_theme'
                    });
                  }).catch(() => {
                    widgetEl.trackEvent('add_to_cart', {
                      title: 'Storefront Item',
                      source: 'storefront_theme'
                    });
                  });
                }
              } catch (_) {}
            }
          } catch (_) {}
          return res;
        };
      }
    } catch (_) {}
  }

  hookStorefrontCartEvents();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoMountWidget);
  } else {
    autoMountWidget();
  }
})();
