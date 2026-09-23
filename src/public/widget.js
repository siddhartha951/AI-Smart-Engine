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
      const actualUtmSource = sessionStorage.getItem('ai_utm_source');
      const actualUtmMedium = sessionStorage.getItem('ai_utm_medium');
      const actualUtmCampaign = sessionStorage.getItem('ai_utm_campaign');
      const actualUtmContent = sessionStorage.getItem('ai_utm_content');
      const actualUtmTerm = sessionStorage.getItem('ai_utm_term');
      const fbclid = sessionStorage.getItem('ai_fbclid') || '';
      const gclid = sessionStorage.getItem('ai_gclid') || '';
      const ttclid = sessionStorage.getItem('ai_ttclid') || '';

      const attrs = {
        '_ai_session_id': sessionId || '',
        '_ai_visitor_id': visitorId || ''
      };
      if (actualUtmSource) attrs['utm_source'] = actualUtmSource;
      if (actualUtmMedium) attrs['utm_medium'] = actualUtmMedium;
      if (actualUtmCampaign) attrs['utm_campaign'] = actualUtmCampaign;
      if (actualUtmContent) attrs['utm_content'] = actualUtmContent;
      if (actualUtmTerm) attrs['utm_term'] = actualUtmTerm;
      if (fbclid) attrs['fbclid'] = fbclid;
      if (gclid) attrs['gclid'] = gclid;
      if (ttclid) attrs['ttclid'] = ttclid;

      await fetch('/cart/update.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          attributes: attrs
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

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Shared by every view (welcome pills, ticket cards). It used to live inside the welcome
  // view only, so rendering a ticket card threw a ReferenceError and froze the whole chat.
  function escapeAttr(value) {
    return escapeHtml(value == null ? '' : String(value));
  }

  function formatChatContent(rawText) {
    if (!rawText) return '';

    // Normalize line endings
    let text = String(rawText).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

    // If an inline sentence had something like:
    // "skin. Here's more information: - Aniwell..." or "skin: • Soothes..."
    // split the bullet to a new line cleanly
    text = text.replace(/([.:!?])\s*[-•]\s+/g, '$1\n• ');

    // Escape HTML first for security
    text = escapeHtml(text);

    // Convert bold: **text** or __text__
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');

    // Convert italic: *text* or _text_
    text = text.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
    text = text.replace(/_([^_\n]+?)_/g, '<em>$1</em>');

    // Parse lines into clean paragraphs and bullet lists
    const lines = text.split('\n');
    let outputHtml = '';
    let inList = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) {
        if (inList) {
          outputHtml += '</ul>';
          inList = false;
        }
        continue;
      }

      // Check if line is a bullet item (starts with •, -, *, or 1.)
      const bulletMatch = line.match(/^[-*•]\s+(.*)$/) || line.match(/^\d+\.\s+(.*)$/);
      if (bulletMatch) {
        if (!inList) {
          outputHtml += '<ul class="chat-bullet-list">';
          inList = true;
        }
        outputHtml += `<li>${bulletMatch[1]}</li>`;
      } else {
        if (inList) {
          outputHtml += '</ul>';
          inList = false;
        }
        outputHtml += `<p class="chat-p">${line}</p>`;
      }
    }

    if (inList) {
      outputHtml += '</ul>';
    }

    return outputHtml;
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
        messages: [],
        pendingPill: null
      };
      this.visitorEmail = null;
      this.nudgeTimer = null;
      this.nudgeDismissTimer = null;
      this._toastTimeout = null;
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

    // --- Per-store browser storage -------------------------------------------
    // Session ids must never leak across stores: a shopper who visits store A
    // then store B on the same backend would otherwise reuse store A's session
    // and hit "Session ... does not belong to store" errors. All keys are
    // namespaced by widget key, with a legacy fallback for existing visitors.
    storageScope() {
      return String(this.widgetKey || this.storeId || 'default');
    }

    storageKey(base) {
      return `${base}:${this.storageScope()}`;
    }

    readStored(base) {
      try {
        return (
          sessionStorage.getItem(this.storageKey(base)) ||
          localStorage.getItem(this.storageKey(base)) ||
          sessionStorage.getItem(base) ||
          localStorage.getItem(base)
        );
      } catch (_) {
        return null;
      }
    }

    writeStored(base, value) {
      try {
        const key = this.storageKey(base);
        sessionStorage.setItem(key, value);
        localStorage.setItem(key, value);
      } catch (_) {}
    }

    // Session-only variant: preserves the original sessionStorage-only
    // semantics for transient UI state (messages, view, open flag).
    writeSessionStored(base, value) {
      try {
        sessionStorage.setItem(this.storageKey(base), value);
      } catch (_) {}
    }

    clearStored(base) {
      try {
        const key = this.storageKey(base);
        sessionStorage.removeItem(key);
        localStorage.removeItem(key);
        sessionStorage.removeItem(base);
        localStorage.removeItem(base);
      } catch (_) {}
    }

    // --- Session error handling ----------------------------------------------
    // Detects backend responses that mean "this session id is unusable":
    // it never existed, expired, was wiped (DB reset/migration), or belongs
    // to a different store. The widget recovers by starting a fresh session
    // instead of showing a permanent error.
    isSessionError(json) {
      if (!json || json.success) return false;
      const code = json.error && json.error.code;
      if (code === 'TENANT_ISOLATION_VIOLATION') return true;
      const msg = typeof json.error === 'string' ? json.error : (json.error && json.error.message) || '';
      return /session.*(not found|unauthorized)|does not belong to store/i.test(String(msg));
    }

    async resetSession() {
      this.clearStored('ai_session_id');
      this.clearStored('ai_visitor_id');
      this.clearStored('ai_chat_messages');
      this.sessionId = null;
      this.visitorId = null;
      const anonymousId = 'anon_' + Math.random().toString(36).substr(2, 9);
      await this.startSession(anonymousId);
    }

    // Validates a session id restored from browser storage. Returns true when
    // the session is usable; clears stale sessions and returns false otherwise.
    // Network failures are treated as "unknown" and keep the session.
    async ensureValidSession() {
      if (!this.sessionId) return false;
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/widget/chat/history?session_id=${this.sessionId}`, {
          headers: this.getHeaders()
        });
        const json = await res.json();
        if (!json.success && this.isSessionError(json)) {
          this.clearStored('ai_session_id');
          this.clearStored('ai_visitor_id');
          this.clearStored('ai_chat_messages');
          this.sessionId = null;
          this.visitorId = null;
          return false;
        }
        if (json.success && json.data && json.data.messages && json.data.messages.length > 0) {
          const recs = json.data.recommendations || [];
          const formatted = json.data.messages.map((m, idx) => ({
            role: m.role,
            content: m.content,
            recommendations: m.role === 'assistant' && idx === json.data.messages.length - 1 ? recs : []
          }));
          this.setState({ messages: formatted, view: 'chat' });
        }
        return true;
      } catch (_) {
        return true;
      }
    }

    async connectedCallback() {
      this.widgetKey = this.getAttribute('data-widget-key') || '';
      this.storeId = this.getAttribute('data-store-id') || this.widgetKey;

      if (!this.widgetKey && !this.storeId) {
        const script = document.querySelector('script[data-widget-key]') || 
                       document.querySelector('script[data-store-id]') || 
                       document.querySelector('script[src*="widget.js"]');
        if (script) {
          this.widgetKey = script.getAttribute('data-widget-key') || script.getAttribute('data-key') || '';
          this.storeId = script.getAttribute('data-store-id') || script.getAttribute('data-store') || this.widgetKey;
          if ((!this.widgetKey || !this.storeId) && script.src) {
            try {
              const parsedUrl = new URL(script.src, window.location.href);
              if (!this.widgetKey) this.widgetKey = parsedUrl.searchParams.get('widget_key') || parsedUrl.searchParams.get('key') || '';
              if (!this.storeId) this.storeId = parsedUrl.searchParams.get('store_id') || parsedUrl.searchParams.get('storeId') || parsedUrl.searchParams.get('store') || this.widgetKey;
            } catch (_) {}
          }
        }
      }

      if (!this.widgetKey && !this.storeId) {
        this.widgetKey = window.AI_SMART_ENGINE_KEY || window.__ai_widget_key || '';
        this.storeId = window.AI_SMART_ENGINE_STORE_ID || window.__ai_store_id || this.widgetKey;
      }
      
      if (!this.widgetKey && !this.storeId) {
        console.error('AI Shopping Assistant: Missing data-widget-key or data-store-id attribute');
        return;
      }

      // Restore previously saved session and chat history if active
      // (per-store namespaced keys; legacy unprefixed keys still honoured)
      try {
        const savedSid = this.readStored('ai_session_id');
        const savedVid = this.readStored('ai_visitor_id');
        if (savedSid) this.sessionId = savedSid;
        if (savedVid) this.visitorId = savedVid;
        this.visitorEmail = this.readStored('ai_visitor_email') || null;

        const savedMsgs = this.readStored('ai_chat_messages');
        const savedView = this.readStored('ai_widget_view');
        const savedOpen = this.readStored('ai_widget_open');

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
        const isMobileScreen = typeof window !== 'undefined' && window.innerWidth <= 600;
        if (savedOpen === 'true' && !isMobileScreen) {
          this.state.isOpen = true;
        } else {
          this.state.isOpen = false;
        }

        if (savedSid && savedVid) {
          syncShopifyCartAttributes(savedSid, savedVid);
        }

        // Validate any restored session against the backend: a stale session id
        // (DB reset, different store, pruned session) is discarded here so it
        // can never cause "Session not found or unauthorized" chat failures.
        if (savedSid && (!this.state.messages || this.state.messages.length === 0)) {
          await this.ensureValidSession();
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
      this.initProactiveNudge();

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
          this.recordMarketingTouchpoint();

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

    async recordMarketingTouchpoint() {
      try {
        const params = new URLSearchParams(window.location.search);
        const utmSource = params.get('utm_source');
        const utmMedium = params.get('utm_medium');
        const utmCampaign = params.get('utm_campaign');
        const utmContent = params.get('utm_content');
        const utmTerm = params.get('utm_term');
        const fbclid = params.get('fbclid');
        const gclid = params.get('gclid');
        const ttclid = params.get('ttclid');

        if (utmSource || fbclid || gclid || ttclid) {
          try {
            if (utmSource) sessionStorage.setItem('ai_utm_source', utmSource);
            if (utmMedium) sessionStorage.setItem('ai_utm_medium', utmMedium);
            if (utmCampaign) sessionStorage.setItem('ai_utm_campaign', utmCampaign);
            if (utmContent) sessionStorage.setItem('ai_utm_content', utmContent);
            if (utmTerm) sessionStorage.setItem('ai_utm_term', utmTerm);
            if (fbclid) sessionStorage.setItem('ai_fbclid', fbclid);
            if (gclid) sessionStorage.setItem('ai_gclid', gclid);
            if (ttclid) sessionStorage.setItem('ai_ttclid', ttclid);
          } catch (_) {}

          const storeId = this.storeId || (this.state.config && this.state.config.store_id);
          if (storeId && this.visitorId) {
            const touchpointKey = `ai_tp_${utmSource || ''}_${utmCampaign || ''}_${fbclid || gclid || ttclid || ''}`;
            if (!sessionStorage.getItem(touchpointKey)) {
              sessionStorage.setItem(touchpointKey, '1');
              await fetch(`${API_BASE_URL}/api/v1/attribution/touchpoint`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  store_id: storeId,
                  visitor_id: this.visitorId,
                  session_id: this.sessionId,
                  utm_source: utmSource || undefined,
                  utm_medium: utmMedium || undefined,
                  utm_campaign: utmCampaign || undefined,
                  utm_content: utmContent || undefined,
                  utm_term: utmTerm || undefined,
                  fbclid: fbclid || undefined,
                  gclid: gclid || undefined,
                  ttclid: ttclid || undefined,
                  landing_page: window.location.href,
                  referrer: document.referrer || undefined
                })
              });
            }
          }
        }
      } catch (_) {}
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
            this.writeStored('ai_session_id', this.sessionId);
            this.writeStored('ai_visitor_id', this.visitorId);
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
          this.visitorEmail = email;
          try {
            this.writeStored('ai_visitor_email', email);
          } catch (_) {}
          if (marketingOptedIn) {
            this.trackEvent('marketing_opted_in');
          }
          this.trackEvent('email_submitted', { email });
          const greeting = this.state.config?.widget?.greeting || 'Hello! How can I help you today?';
          const pending = this.state.pendingPill;
          this.setState({ 
            view: 'chat',
            pendingPill: null,
            messages: [{ role: 'assistant', content: greeting }] 
          });

          // If visitor clicked a quick action pill prior to consent, ask AI or open ticket
          if (pending && pending.label) {
            setTimeout(() => {
              if (pending.id === 'whatsapp_support') {
                this.openTicketEscalationPrompt('Customer requested WhatsApp / Human Support');
              } else {
                this.sendMessage(pending.label);
              }
            }, 300);
          }
        } else {
          alert('Error saving details: ' + (json.error?.message || 'Unknown error'));
        }
      } catch (err) {
        console.error('Failed to submit consent', err);
      }
    }

    async sendMessage(text) {
      if (!text.trim()) return;

      // Ensure we have a live session before sending (e.g. tracking was
      // disabled at init, or the earlier session creation failed).
      if (!this.sessionId || !this.visitorId) {
        const anonymousId = 'anon_' + Math.random().toString(36).substr(2, 9);
        await this.startSession(anonymousId);
      }

      // Add user message to state immediately
      const newMessages = [...this.state.messages, { role: 'user', content: text }];
      this.setState({ messages: newMessages });

      // Add loading state
      this.setState({ messages: [...newMessages, { role: 'assistant', content: '...', isLoading: true }] });

      await this.deliverMessage(text, false);
    }

    // Posts one chat message. If the backend rejects the session id as stale
    // ("Session not found or unauthorized" / "does not belong to store"), a
    // fresh session is created and the message is retried once automatically.
    async deliverMessage(text, retried) {
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

        if (!json.success && !retried && this.isSessionError(json)) {
          // Stale session id (DB reset, cross-store contamination, pruned
          // session): heal transparently and retry the message once.
          await this.resetSession();
          if (this.sessionId) {
            return this.deliverMessage(text, true);
          }
        }

        // Remove loading state and add real response
        const updatedMessages = [...this.state.messages];
        // replace the loading message at the end
        const errMsg = json.error && typeof json.error === 'object' ? json.error.message : json.error;
        updatedMessages[updatedMessages.length - 1] = {
          role: 'assistant',
          content: json.success ? json.data.message : 'Error: ' + (errMsg || 'Unknown error'),
          recommendations: json.success ? json.data.recommendations : []
        };

        this.setState({ messages: updatedMessages });

        // Auto-offer human ticket if customer asks for human/ticket/complaint or backend flagged escalation
        const isHumanQuery = /(human|agent|real person|customer care|talk to someone|support ticket|complaint|representative|executive|create ticket|raise ticket|open ticket)/i.test(text);
        const replyText = json.success ? (json.data?.message || '') : '';
        const isAiUnsure = !json.success || /(contact (our )?support|reach out to (our )?support|support team|unable to assist|can't help with this)/i.test(replyText);
        const shouldEscalate = Boolean(json.data?.should_escalate_ticket) || isHumanQuery || isAiUnsure;

        if (json.data?.ticket_revert_duration) {
          this.ticketRevertDuration = json.data.ticket_revert_duration;
        }

        if (shouldEscalate) {
          const subject = json.data?.ticket_subject || (isHumanQuery ? 'Customer requested support ticket' : 'Inquiry requires store support');
          const revertDur = json.data?.ticket_revert_duration || this.ticketRevertDuration || 'within 24 hours';
          setTimeout(() => {
            this.openTicketEscalationPrompt(subject, revertDur);
          }, 350);
        }
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
      // Kept for backward compatibility; delegates to the validating loader.
      if (sessionId) {
        this.sessionId = this.sessionId || sessionId;
        await this.ensureValidSession();
      }
    }

    setState(newState) {
      if (newState.isOpen) {
        this.hideProactiveNudge();
      }
      this.state = { ...this.state, ...newState };
      try {
        if (this.state.messages && this.state.messages.length > 0) {
          this.writeSessionStored('ai_chat_messages', JSON.stringify(this.state.messages));
        }
        this.writeSessionStored('ai_widget_view', this.state.view || 'welcome');
        this.writeSessionStored('ai_widget_open', this.state.isOpen ? 'true' : 'false');
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

    async openTicketEscalationPrompt(reason = '', revertDuration = '') {
      const duration = revertDuration || this.ticketRevertDuration || 'within 24 hours';
      this.ticketRevertDuration = duration;
      const email = this.visitorEmail || this.readStored('ai_visitor_email') || '';

      const promptMessage = {
        role: 'assistant',
        content: `I will open a support ticket for you right away. Our team will review this full chat transcript and revert to your email ${duration}.`,
        isTicketPrompt: true,
        ticketEmail: email,
        ticketSubject: reason || 'Customer inquiry via storefront chat',
        revertDuration: duration
      };

      const newMessages = [...this.state.messages, promptMessage];
      this.setState({
        view: 'chat',
        messages: newMessages
      });

      // If customer email is already known, auto-submit the ticket instantly for a 1-tap seamless experience
      if (email && email.includes('@')) {
        const msgIdx = newMessages.length - 1;
        await this.submitSupportTicket(email, reason || 'Customer inquiry via storefront chat', msgIdx, duration);
      }
    }

    async submitSupportTicket(email, reason, msgIndex, revertDuration) {
      if (!email || !email.includes('@')) {
        this.showToast('Please enter a valid email address');
        return;
      }

      const storeId = (this.state.config && this.state.config.store_id) || this.storeId;
      if (!storeId && !this.widgetKey) {
        this.showToast('Store configuration error');
        return;
      }

      try {
        const transcript = this.state.messages
          .filter(m => !m.isLoading && !m.isTicketPrompt && typeof m.content === 'string' && m.content.trim())
          .map(m => ({ role: m.role, content: m.content }));

        const res = await fetch(`${API_BASE_URL}/api/v1/widget/tickets`, {
          method: 'POST',
          headers: this.getHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            widget_key: this.widgetKey || undefined,
            store_id: storeId || undefined,
            session_id: this.sessionId || undefined,
            customer_email: email,
            subject: reason || 'Customer chat escalation',
            chat_transcript: transcript
          })
        });

        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.message || (json.error && json.error.message) || 'Failed to submit ticket');
        }

        this.visitorEmail = email;
        try {
          this.writeStored('ai_visitor_email', email);
        } catch (_) {}

        const duration = revertDuration || this.ticketRevertDuration || 'within 24 hours';
        const msgs = [...this.state.messages];
        const targetIdx = (msgIndex !== undefined && msgs[msgIndex]) ? msgIndex : (msgs.length - 1);
        if (msgs[targetIdx]) {
          msgs[targetIdx] = {
            ...msgs[targetIdx],
            isTicketSubmitted: true,
            submittedTicketId: json.data?.ticket_id,
            submittedEmail: email,
            revertDuration: duration
          };
          this.setState({ messages: msgs });
        }

        this.showToast('Support ticket submitted successfully!');
      } catch (err) {
        this.showToast(err.message || 'Error submitting ticket', true);
      }
    }

    initProactiveNudge() {
      if (this.nudgeTimer) {
        clearInterval(this.nudgeTimer);
        this.nudgeTimer = null;
      }
      const enabled = this.state.config?.widget?.proactive_nudge_enabled !== false;
      if (!enabled) return;

      const intervalSec = Number(this.state.config?.widget?.proactive_nudge_interval_seconds || 60);
      const intervalMs = Math.max(10, intervalSec) * 1000;

      this.nudgeTimer = setInterval(() => {
        if (!this.state.isOpen && typeof document !== 'undefined' && document.visibilityState === 'visible') {
          this.showProactiveNudge();
        }
      }, intervalMs);
    }

    showProactiveNudge() {
      const nudgeEl = this.shadowRoot.getElementById('proactive-nudge');
      if (nudgeEl && !this.state.isOpen) {
        nudgeEl.classList.add('visible');
        if (this.nudgeDismissTimer) clearTimeout(this.nudgeDismissTimer);
        this.nudgeDismissTimer = setTimeout(() => {
          this.hideProactiveNudge();
        }, 10000);
      }
    }

    hideProactiveNudge() {
      const nudgeEl = this.shadowRoot.getElementById('proactive-nudge');
      if (nudgeEl) {
        nudgeEl.classList.remove('visible');
      }
      if (this.nudgeDismissTimer) {
        clearTimeout(this.nudgeDismissTimer);
        this.nudgeDismissTimer = null;
      }
    }

    showToast(message) {
      let toast = this.shadowRoot.getElementById('widget-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'widget-toast';
        toast.className = 'widget-toast';
        const popup = this.shadowRoot.getElementById('popup') || this.shadowRoot.getElementById('widget-container');
        if (popup) popup.appendChild(toast);
      }
      toast.textContent = message;
      toast.classList.add('show');
      clearTimeout(this._toastTimeout);
      this._toastTimeout = setTimeout(() => {
        toast.classList.remove('show');
      }, 3200);
    }

    getStyles() {
      const primaryColor = this.state.config?.widget?.primary_colour || '#4f46e5';
      const secondaryColor = this.state.config?.widget?.secondary_colour || '#ffffff';
      const position = this.state.config?.widget?.position || 'bottom-right';
      const isLeft = position === 'bottom-left';
      
      return `
        :host {
          all: initial; /* CSS Reset */
          position: fixed !important;
          bottom: 0 !important;
          ${isLeft ? 'left: 0 !important; right: auto !important;' : 'right: 0 !important; left: auto !important;'}
          z-index: 2147483647 !important;
          pointer-events: none !important;
          display: block !important;
          width: 0 !important;
          height: 0 !important;
          overflow: visible !important;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }
        
        #widget-container {
          position: fixed !important;
          bottom: 22px !important;
          ${isLeft ? 'left: 22px !important; right: auto !important; align-items: flex-start !important;' : 'right: 22px !important; left: auto !important; align-items: flex-end !important;'}
          z-index: 2147483647 !important;
          pointer-events: none !important;
          display: flex !important;
          flex-direction: column !important;
          width: auto !important;
          height: auto !important;
          max-width: 100vw !important;
          box-sizing: border-box !important;
        }

        #widget-container.is-open #launcher,
        #widget-container.is-open .proactive-nudge {
          display: none !important;
          opacity: 0 !important;
          pointer-events: none !important;
          visibility: hidden !important;
        }

        #launcher {
          pointer-events: auto !important;
          background: linear-gradient(135deg, ${primaryColor} 0%, #1e1b4b 100%);
          color: ${secondaryColor};
          border: 1.5px solid rgba(255, 255, 255, 0.28);
          border-radius: 50px;
          padding: 8px 18px 8px 10px;
          font-size: 14px;
          font-weight: 600;
          letter-spacing: -0.01em;
          cursor: pointer;
          box-shadow: 0 16px 36px -6px rgba(0, 0, 0, 0.38), 0 0 0 1px rgba(255, 255, 255, 0.15) inset, 0 4px 12px rgba(99, 102, 241, 0.25);
          transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.25s ease, opacity 0.2s ease;
          display: inline-flex;
          align-items: center;
          gap: 10px;
          user-select: none;
          outline: none;
          min-height: 48px;
          animation: float3d 4s ease-in-out infinite;
          transform-style: preserve-3d;
          perspective: 600px;
        }

        @keyframes float3d {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(-6px) rotate(0.8deg); }
        }
        
        #launcher:hover {
          animation-play-state: paused;
          transform: translateY(-4px) scale(1.03);
          box-shadow: 0 22px 42px -6px rgba(0, 0, 0, 0.44), 0 0 24px rgba(99, 102, 241, 0.35);
        }

        #launcher:active {
          transform: translateY(0) scale(0.97);
        }

        .launcher-avatar-wrap {
          position: relative;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 10px rgba(0, 0, 0, 0.25);
          background: #ffffff;
          flex-shrink: 0;
        }

        .launcher-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          object-fit: cover;
          display: block;
          border: 1.5px solid rgba(255, 255, 255, 0.9);
        }

        .launcher-online-ring {
          position: absolute;
          bottom: -1px;
          right: -1px;
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: #10b981;
          border: 2px solid ${primaryColor};
          box-shadow: 0 0 6px #10b981;
        }

        .launcher-sparkle {
          font-size: 13px;
          display: inline-block;
          animation: sparkleSpin 3s linear infinite;
        }

        @keyframes sparkleSpin {
          0%, 100% { transform: scale(1) rotate(0deg); opacity: 0.9; }
          50% { transform: scale(1.2) rotate(180deg); opacity: 1; }
        }

        /* Proactive 3D Nudge Speech Bubble */
        .proactive-nudge {
          position: relative;
          margin-bottom: 12px;
          max-width: 310px;
          background: #ffffff;
          color: #0f172a;
          border-radius: 16px;
          padding: 12px 14px;
          box-shadow: 0 20px 40px -6px rgba(0, 0, 0, 0.28), 0 2px 10px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.05);
          display: none;
          pointer-events: auto;
          cursor: pointer;
          opacity: 0;
          transform: translateY(12px) scale(0.94);
          transition: opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          z-index: 10;
        }

        .proactive-nudge.visible {
          display: flex;
          opacity: 1;
          transform: translateY(0) scale(1);
          animation: nudgePopIn 0.35s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @keyframes nudgePopIn {
          0% { opacity: 0; transform: translateY(14px) scale(0.92); }
          70% { transform: translateY(-3px) scale(1.02); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }

        .nudge-avatar-wrap {
          position: relative;
          width: 38px;
          height: 38px;
          flex-shrink: 0;
          margin-right: 10px;
        }

        .nudge-avatar {
          width: 38px;
          height: 38px;
          border-radius: 50%;
          object-fit: cover;
          border: 2px solid ${primaryColor};
          box-shadow: 0 4px 10px rgba(0,0,0,0.15);
        }

        .nudge-online-dot {
          position: absolute;
          bottom: 0px;
          right: 0px;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #10b981;
          border: 2px solid #ffffff;
        }

        .nudge-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .nudge-header {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .nudge-name {
          font-size: 12.5px;
          font-weight: 700;
          color: #0f172a;
        }

        .nudge-status-badge {
          font-size: 9.5px;
          font-weight: 700;
          color: #047857;
          background: #d1fae5;
          padding: 1px 6px;
          border-radius: 10px;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }

        .nudge-message {
          font-size: 12.5px;
          line-height: 1.35;
          color: #334155;
          margin: 0;
        }

        .nudge-close-btn {
          background: transparent;
          border: none;
          color: #94a3b8;
          font-size: 18px;
          line-height: 1;
          cursor: pointer;
          padding: 0 0 0 6px;
          align-self: flex-start;
          transition: color 0.15s;
        }

        .nudge-close-btn:hover {
          color: #0f172a;
        }

        .nudge-tail {
          position: absolute;
          bottom: -7px;
          ${isLeft ? 'left: 28px;' : 'right: 28px;'}
          width: 14px;
          height: 14px;
          background: #ffffff;
          transform: rotate(45deg);
          border-bottom: 1px solid rgba(0,0,0,0.06);
          border-right: 1px solid rgba(0,0,0,0.06);
        }

        .header-title-container {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .header-avatar-wrap {
          position: relative;
          width: 34px;
          height: 34px;
          flex-shrink: 0;
        }

        .header-avatar {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          object-fit: cover;
          border: 2px solid rgba(255, 255, 255, 0.85);
          display: block;
        }

        .online-dot {
          position: absolute;
          bottom: -1px;
          right: -1px;
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: #10b981;
          border: 2px solid ${primaryColor};
        }

        .header-text-col {
          display: flex;
          flex-direction: column;
        }

        .header-name {
          font-size: 14px;
          font-weight: 700;
          line-height: 1.25;
          letter-spacing: -0.01em;
        }

        .header-subtext {
          font-size: 11px;
          opacity: 0.82;
          font-weight: 500;
        }

        /* Custom Merchant CSS overrides */
        ${this.state.config?.widget?.custom_css || ''}
        
        #popup {
          width: 380px;
          height: 570px;
          max-height: calc(100vh - 110px);
          background-color: #ffffff;
          border-radius: 18px;
          box-shadow: 0 20px 48px -8px rgba(0, 0, 0, 0.28), 0 4px 14px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.06);
          display: none !important;
          pointer-events: none !important;
          flex-direction: column;
          overflow: hidden;
          margin-bottom: 14px;
          opacity: 0;
          transform: translateY(16px) scale(0.97);
          transition: opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1), transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
          box-sizing: border-box;
        }
        
        #popup.open {
          display: flex !important;
          pointer-events: auto !important;
          opacity: 1;
          transform: translateY(0) scale(1);
        }
        
        .header {
          background-color: ${primaryColor};
          color: ${secondaryColor};
          padding: 14px 18px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-weight: 600;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          flex-shrink: 0;
        }
        
        .close-btn {
          background: rgba(255, 255, 255, 0.15);
          border: none;
          color: ${secondaryColor};
          cursor: pointer;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          line-height: 1;
          padding: 0;
          transition: all 0.2s ease;
        }

        .close-btn:hover {
          background: rgba(255, 255, 255, 0.28);
          transform: scale(1.08);
        }

        .header-actions {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .header-icon-btn {
          background: rgba(255, 255, 255, 0.16);
          border: 1px solid rgba(255, 255, 255, 0.25);
          color: ${secondaryColor};
          cursor: pointer;
          width: 30px;
          height: 30px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          transition: all 0.2s ease;
          outline: none;
        }

        .header-icon-btn:hover {
          background: rgba(255, 255, 255, 0.3);
          transform: scale(1.08);
        }

        .header-icon-btn:active {
          transform: scale(0.95);
        }

        .btn-need-help-header {
          background: rgba(255, 255, 255, 0.22);
          border: 1px solid rgba(255, 255, 255, 0.45);
          color: ${secondaryColor};
          cursor: pointer;
          height: 28px;
          padding: 0 10px;
          border-radius: 14px;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          font-weight: 600;
          white-space: nowrap;
          transition: all 0.2s ease;
          outline: none;
          backdrop-filter: blur(4px);
        }

        .btn-need-help-header:hover {
          background: rgba(255, 255, 255, 0.35);
          transform: translateY(-1px);
        }

        .btn-need-help-header:active {
          transform: scale(0.96);
        }

        .chat-action-pills-bar {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 14px;
          background: #ffffff;
          border-top: 1px solid #f1f5f9;
          overflow-x: auto;
          scrollbar-width: none;
        }
        .chat-action-pills-bar::-webkit-scrollbar {
          display: none;
        }

        .btn-need-help-chip {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          background: rgba(99, 102, 241, 0.08);
          color: #4f46e5;
          border: 1px solid rgba(99, 102, 241, 0.25);
          border-radius: 14px;
          padding: 4px 10px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
          transition: all 0.15s ease;
        }
        .btn-need-help-chip:hover {
          background: rgba(99, 102, 241, 0.16);
          border-color: #4f46e5;
        }
        
        .content {
          flex: 1;
          padding: 18px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          background-color: #f8fafc;
          color: #0f172a;
          box-sizing: border-box;
        }
        
        h3 {
          margin-top: 0;
          font-size: 17px;
          font-weight: 700;
          color: #0f172a;
          letter-spacing: -0.01em;
        }
        
        p {
          font-size: 13.5px;
          line-height: 1.5;
          margin-bottom: 18px;
          color: #475569;
        }
        
        .form-group {
          margin-bottom: 14px;
        }
        
        label {
          display: block;
          font-size: 12px;
          font-weight: 600;
          margin-bottom: 6px;
          color: #334155;
        }
        
        input[type="email"],
        input[type="tel"] {
          width: 100%;
          padding: 10px 14px;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          font-size: 13.5px;
          box-sizing: border-box;
          background: #ffffff;
          transition: border-color 0.2s, box-shadow 0.2s;
          outline: none;
        }

        input[type="email"]:focus,
        input[type="tel"]:focus {
          border-color: ${primaryColor};
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.18);
        }
        
        .checkbox-group {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin-bottom: 18px;
        }
        
        .checkbox-group input {
          margin-top: 3px;
          accent-color: ${primaryColor};
        }
        
        .checkbox-group label {
          font-weight: normal;
          margin-bottom: 0;
          font-size: 12.5px;
          line-height: 1.45;
          color: #475569;
        }
        
        .btn {
          background-color: ${primaryColor};
          color: ${secondaryColor};
          border: none;
          border-radius: 8px;
          padding: 12px 18px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          width: 100%;
          text-align: center;
          transition: all 0.2s;
          min-height: 44px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        
        .btn:hover {
          opacity: 0.93;
          transform: translateY(-1px);
        }

        .btn:active {
          transform: translateY(0);
        }

        /* Welcome Screen & Quick Action Pills */
        .welcome-wrap {
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding-bottom: 8px;
        }

        .welcome-hero-box {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          padding: 16px 14px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
        }

        .welcome-hero-box h3 {
          margin: 0 0 6px 0;
          font-size: 16.5px;
          font-weight: 700;
          color: #0f172a;
          letter-spacing: -0.01em;
        }

        .welcome-hero-box p {
          margin: 0 0 14px 0;
          font-size: 13.5px;
          color: #475569;
          line-height: 1.45;
        }

        .welcome-pills-section {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .welcome-pill-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .pill-group-title {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #64748b;
          display: flex;
          align-items: center;
          gap: 6px;
          padding-left: 2px;
        }

        .pill-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 8px;
        }

        .welcome-pill {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          padding: 9px 10px;
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          text-align: left;
          font-family: inherit;
          font-size: 12px;
          font-weight: 500;
          color: #1e293b;
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
          user-select: none;
          min-height: 42px;
          box-sizing: border-box;
          position: relative;
          outline: none;
        }

        .welcome-pill:hover {
          background: #f8fafc;
          border-color: ${primaryColor};
          transform: translateY(-1.5px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.07);
          color: ${primaryColor};
        }

        .welcome-pill:active {
          transform: translateY(0);
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
        }

        .welcome-pill .pill-icon {
          font-size: 15px;
          flex-shrink: 0;
          line-height: 1;
        }

        .welcome-pill .pill-label {
          flex: 1;
          font-size: 12px;
          font-weight: 500;
          line-height: 1.25;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }

        .btn-back-options {
          transition: all 0.2s ease;
        }

        .btn-back-options:hover {
          background: #f1f5f9 !important;
          border-color: #94a3b8 !important;
          color: #0f172a !important;
          transform: translateY(-1px);
        }

        .btn-back-options:active {
          transform: translateY(0);
        }
        
        .policy-link {
          font-size: 11.5px;
          color: #64748b;
          text-align: center;
          margin-top: 12px;
        }

        .policy-link a {
          color: #64748b;
          text-decoration: underline;
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
          padding: 12px 15px;
          border-radius: 14px;
          font-size: 13.5px;
          line-height: 1.5;
          max-width: 86%;
          word-break: break-word;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
        }
        
        .msg.assistant {
          background-color: #ffffff;
          color: #0f172a;
          align-self: flex-start;
          border: 1px solid #e2e8f0;
          border-bottom-left-radius: 3px;
        }
        
        .msg.user {
          background-color: ${primaryColor};
          color: #ffffff !important;
          align-self: flex-end;
          border-bottom-right-radius: 3px;
        }
        .msg.user .msg-text,
        .msg.user * {
          color: #ffffff !important;
        }


        .msg-text {
          font-size: 13.5px;
          line-height: 1.55;
          word-break: break-word;
        }
        .msg-text p.chat-p {
          margin: 0 0 8px 0;
          line-height: 1.55;
        }
        .msg-text p.chat-p:last-child {
          margin-bottom: 0;
        }
        .msg-text strong {
          font-weight: 600;
          color: inherit;
        }
        .msg.assistant .msg-text strong {
          color: #0f172a;
        }
        .msg-text ul.chat-bullet-list {
          margin: 6px 0 8px 0;
          padding-left: 20px;
          list-style-type: disc;
        }
        .msg-text ul.chat-bullet-list li {
          margin-bottom: 4px;
          line-height: 1.45;
          color: inherit;
        }
        .msg-text ul.chat-bullet-list li:last-child {
          margin-bottom: 0;
        }
        
        .chat-input {
          display: flex;
          align-items: center;
          gap: 8px;
          border-top: 1px solid #e2e8f0;
          padding: 12px 14px;
          background: #ffffff;
          flex-shrink: 0;
          box-sizing: border-box;
        }
        
        .chat-input input {
          flex: 1;
          border: 1px solid #cbd5e1;
          border-radius: 24px;
          padding: 10px 16px;
          font-size: 13.5px;
          outline: none;
          background: #f8fafc;
          transition: border-color 0.2s, box-shadow 0.2s;
        }

        .chat-input input:focus {
          border-color: ${primaryColor};
          background: #ffffff;
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
        }
        
        .chat-input button {
          background: ${primaryColor};
          color: ${secondaryColor};
          border: none;
          border-radius: 20px;
          padding: 10px 16px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          min-height: 38px;
          transition: all 0.2s;
        }
        
        .chat-input button:hover {
          opacity: 0.92;
          transform: scale(1.02);
        }

        .chat-input button:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }

        .product-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 10px;
        }

        .product-carousel-wrapper {
          position: relative;
          width: 100%;
          margin-top: 10px;
          display: flex;
          align-items: center;
        }

        .product-carousel-track {
          display: flex;
          gap: 12px;
          overflow-x: auto;
          scroll-snap-type: x mandatory;
          scrollbar-width: none;
          -ms-overflow-style: none;
          -webkit-overflow-scrolling: touch;
          padding: 4px 2px 8px 2px;
          width: 100%;
        }

        .product-carousel-track::-webkit-scrollbar {
          display: none;
        }

        .product-card {
          flex: 0 0 225px;
          scroll-snap-align: start;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          overflow: hidden;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.06);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
          display: flex;
          flex-direction: column;
        }

        .product-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 22px rgba(0, 0, 0, 0.1);
          border-color: #cbd5e1;
        }

        .carousel-nav-btn {
          position: absolute;
          top: 38%;
          transform: translateY(-50%);
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.95);
          border: 1px solid #cbd5e1;
          box-shadow: 0 3px 10px rgba(0,0,0,0.18);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          z-index: 10;
          font-size: 11px;
          font-weight: 700;
          color: #1e293b;
          transition: all 0.15s;
          padding: 0;
        }

        .carousel-nav-btn:hover {
          background: #ffffff;
          transform: translateY(-50%) scale(1.1);
          box-shadow: 0 4px 14px rgba(0,0,0,0.25);
        }

        .carousel-nav-btn.prev {
          left: -6px;
        }

        .carousel-nav-btn.next {
          right: -6px;
        }

        .carousel-dots-indicator {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 5px;
          margin-top: 4px;
          margin-bottom: 6px;
        }

        .carousel-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #cbd5e1;
          cursor: pointer;
          transition: all 0.2s;
        }

        .carousel-dot.active {
          background: ${primaryColor};
          width: 16px;
          border-radius: 6px;
        }

        .product-card-thumb-wrap {
          position: relative;
          width: 100%;
          height: 125px;
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
          font-size: 9.5px;
          font-weight: 700;
          padding: 2px 7px;
          border-radius: 12px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.15);
        }

        .product-badge-popular {
          position: absolute;
          top: 8px;
          left: 8px;
          background: linear-gradient(135deg, #fbbf24, #d97706);
          color: #451a03;
          font-size: 9.5px;
          font-weight: 800;
          padding: 2px 8px;
          border-radius: 12px;
          letter-spacing: 0.3px;
          box-shadow: 0 2px 6px rgba(217, 119, 6, 0.35);
          white-space: nowrap;
        }

        .product-badge-out {
          position: absolute;
          top: 8px;
          right: 8px;
          background: #ef4444;
          color: #ffffff;
          font-size: 9.5px;
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
          gap: 5px;
        }

        .product-card-title {
          font-size: 12.5px;
          font-weight: 600;
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
          flex-wrap: wrap;
          gap: 3px;
        }

        .product-card-price {
          font-size: 14px;
          font-weight: 700;
          color: #047857;
        }

        .product-card-compare-price {
          font-size: 11.5px;
          font-weight: 500;
          color: #94a3b8;
          text-decoration: line-through;
          margin-left: 4px;
        }

        .product-card-discount-tag {
          font-size: 10px;
          font-weight: 700;
          color: #b91c1c;
          background: #fee2e2;
          padding: 1px 5px;
          border-radius: 4px;
          margin-left: 4px;
        }

        /* AI Special Price & Razorpay 1-Click Copy Badge */
        .ai-special-badge {
          background: linear-gradient(135deg, #fef9c3 0%, #fef3c7 100%);
          border: 1px solid #fde047;
          border-radius: 8px;
          padding: 6px 8px;
          margin: 4px 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .ai-badge-top {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          color: #854d0e;
        }

        .ai-badge-star {
          font-size: 11px;
        }

        .ai-badge-label {
          font-weight: 600;
        }

        .ai-badge-price {
          color: #713f12;
          font-size: 12.5px;
          font-weight: 700;
        }

        .ai-coupon-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
        }

        .ai-coupon-code {
          font-family: monospace;
          font-size: 11px;
          font-weight: 700;
          background: #ffffff;
          border: 1px dashed #ca8a04;
          color: #a16207;
          padding: 2px 7px;
          border-radius: 4px;
          letter-spacing: 0.5px;
        }

        .btn-copy-coupon {
          background: #eab308;
          color: #713f12;
          border: none;
          border-radius: 4px;
          padding: 3px 8px;
          font-size: 10.5px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s;
          display: inline-flex;
          align-items: center;
          gap: 3px;
        }

        .btn-copy-coupon:hover {
          background: #facc15;
          transform: scale(1.03);
        }

        .btn-copy-coupon.copied {
          background: #10b981 !important;
          color: #ffffff !important;
        }

        .product-card-btn-group {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
          margin-top: 4px;
        }

        .btn-view-product {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 7px 8px;
          background: #f8fafc;
          color: #334155;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          font-size: 11px;
          font-weight: 600;
          text-decoration: none;
          transition: all 0.15s;
          cursor: pointer;
          min-height: 32px;
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
          padding: 7px 8px;
          background: ${primaryColor};
          color: ${secondaryColor};
          border: none;
          border-radius: 8px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
          min-height: 32px;
        }

        .btn-add-to-cart:hover {
          opacity: 0.92;
        }

        .btn-add-to-cart.added {
          background: #10b981 !important;
          color: #ffffff !important;
        }

        .widget-toast {
          position: absolute;
          top: 14px;
          left: 50%;
          transform: translateX(-50%) translateY(-24px);
          background: #0f172a;
          color: #ffffff;
          padding: 8px 16px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 600;
          box-shadow: 0 10px 25px rgba(0,0,0,0.3);
          pointer-events: none;
          opacity: 0;
          transition: all 0.28s cubic-bezier(0.16, 1, 0.3, 1);
          z-index: 9999;
          white-space: nowrap;
          max-width: 90%;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .widget-toast.show {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }
        
        /* Mobile behavior: Non-intrusive bottom sheet with screen headroom */
        @media (max-width: 640px) {
          #widget-container {
            bottom: 16px !important;
            ${isLeft ? 'left: 16px !important; right: auto !important;' : 'right: 16px !important; left: auto !important;'}
          }

          #launcher {
            padding: 10px 18px;
            font-size: 13.5px;
            min-height: 46px;
          }
          
          #popup.open {
            position: fixed !important;
            bottom: 16px !important;
            left: 12px !important;
            right: 12px !important;
            width: auto !important;
            max-width: 420px !important;
            margin: 0 auto !important;
            height: min(540px, calc(100dvh - 32px)) !important;
            max-height: 82vh !important;
            border-radius: 20px !important;
            box-shadow: 0 16px 40px -4px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(0, 0, 0, 0.1) !important;
          }

          /* Prevent mobile screen zoom on input focus */
          input,
          input[type="text"],
          input[type="email"],
          input[type="tel"],
          .chat-input input {
            font-size: 16px !important;
            -webkit-text-size-adjust: 100% !important;
            text-size-adjust: 100% !important;
          }
        }
      `;
    }

    renderInit() {
      this.shadowRoot.innerHTML = `
        <style>
          :host {
            all: initial;
            position: fixed !important;
            bottom: 0 !important;
            right: 0 !important;
            pointer-events: none !important;
            display: block !important;
            width: 0 !important;
            height: 0 !important;
          }
          #widget-container {
            position: fixed !important;
            bottom: 20px !important;
            right: 20px !important;
            pointer-events: none !important;
          }
          #launcher { display: none; }
        </style>
        <div id="widget-container"></div>
      `;
    }

    render() {
      const { widget: widgetConfig, assistant: assistantConfig } = this.state.config || {};
      
      const buttonText = widgetConfig?.button_text || 'Ask our shopping assistant';
      const greeting = widgetConfig?.greeting || 'Hello! How can I help you today?';
      const assistantName = assistantConfig?.assistant_name || 'Mira';
      const headerTitle = widgetConfig?.header_title || assistantName;
      const persona = widgetConfig?.avatar_persona || 'female_3d';
      let avatarUrl = widgetConfig?.avatar_url || '';
      if (!avatarUrl) {
        if (persona === 'male_3d') avatarUrl = `${API_BASE_URL}/assets/avatars/arjun-3d.jpg`;
        else if (persona === 'bot_3d') avatarUrl = `${API_BASE_URL}/assets/avatars/cosmo-3d.jpg`;
        else avatarUrl = `${API_BASE_URL}/assets/avatars/mira-3d.jpg`;
      }
      const policyUrl = assistantConfig?.privacy_policy_url || '#';

      const offerCode = widgetConfig?.offer_code || '';
      const offerDiscount = Number(widgetConfig?.offer_discount_percent || 0);
      let nudgeMessage = `👋 Hi! I'm ${assistantName}. Looking for recommendations or size help today?`;
      if (widgetConfig?.offer_text && widgetConfig.offer_text.trim()) {
        nudgeMessage = widgetConfig.offer_text.trim();
      } else if (offerCode && offerDiscount > 0) {
        nudgeMessage = `👋 Hi! Looking for recommendations? Tap here to get ${offerDiscount}% OFF with code ${offerCode}!`;
      }

      const avatarHeaderHtml = `<img src="${avatarUrl}" class="header-avatar" alt="${assistantName}" />`;
      const avatarLauncherHtml = `
        <div class="launcher-avatar-wrap">
          <img src="${avatarUrl}" class="launcher-avatar" alt="${assistantName}" />
          <span class="launcher-online-ring"></span>
        </div>
      `;

      this.shadowRoot.innerHTML = `
        <style>${this.getStyles()}</style>
        <div id="widget-container" class="${this.state.isOpen ? 'is-open' : ''}">
          <div id="popup" class="${this.state.isOpen ? 'open' : ''}">
            <div id="widget-toast" class="widget-toast"></div>
            <div class="header">
              <div class="header-title-container">
                ${this.state.view === 'lead-capture' ? `
                  <button type="button" class="header-icon-btn btn-back-header" id="header-btn-back" aria-label="Back to options" title="Back to Options" style="margin-right: 6px; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center;">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
                  </button>
                ` : ''}
                <div class="header-avatar-wrap">
                  ${avatarHeaderHtml}
                  <span class="online-dot"></span>
                </div>
                <div class="header-text-col">
                  <span class="header-name">${headerTitle}</span>
                  <span class="header-subtext">Online • AI Assistant</span>
                </div>
              </div>
              <div class="header-actions">
                ${this.state.view === 'chat' ? `
                  <button type="button" class="btn-need-help-header btn-human-ticket" aria-label="Human Helpdesk" title="Need Human Support? Open Ticket">
                    <span>🛎️ Need Help?</span>
                  </button>
                ` : ''}
                <button class="header-icon-btn btn-minimize" aria-label="Minimize Assistant" title="Minimize">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                </button>
                <button class="header-icon-btn btn-close" aria-label="Close Assistant" title="Close">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              </div>
            </div>
            
            <div class="content">
              ${this.renderView(greeting, policyUrl)}
            </div>
          </div>

          ${!this.state.isOpen ? `
            <div id="proactive-nudge" class="proactive-nudge" role="alert">
              <div class="nudge-avatar-wrap">
                <img src="${avatarUrl}" class="nudge-avatar" alt="${assistantName}" />
                <span class="nudge-online-dot"></span>
              </div>
              <div class="nudge-content">
                <div class="nudge-header">
                  <span class="nudge-name">${assistantName}</span>
                  <span class="nudge-status-badge">AI Online</span>
                </div>
                <p class="nudge-message">${nudgeMessage}</p>
              </div>
              <button type="button" class="nudge-close-btn" aria-label="Dismiss">&times;</button>
              <div class="nudge-tail"></div>
            </div>
            
            <button id="launcher" aria-label="Toggle Shopping Assistant">
              ${avatarLauncherHtml}
              <span>${buttonText}</span>
              <span class="launcher-sparkle">✨</span>
            </button>
          ` : ''}
        </div>
      `;

      this.attachEventListeners();
    }

    renderView(greeting, policyUrl) {
      const { widget: widgetConfig } = this.state.config || {};

      if (this.state.view === 'welcome') {
        const assistant = this.state.config?.assistant || {};
        const rawPills = assistant.quick_action_pills;
        let pills = [];
        if (Array.isArray(rawPills)) {
          pills = rawPills;
        } else if (typeof rawPills === 'string') {
          try { pills = JSON.parse(rawPills); } catch (_) {}
        }
        
        if (!pills || pills.length === 0) {
          pills = [
            { id: 'track_order', group: 'support', label: 'Track My Order', icon: '📦', enabled: true },
            { id: 'return_policy', group: 'support', label: 'Return & Exchange Policy', icon: '🔄', enabled: true },
            { id: 'shipping_delivery', group: 'support', label: 'Shipping & Delivery', icon: '🚚', enabled: true },
            { id: 'whatsapp_support', group: 'support', label: 'WhatsApp / Human Support', icon: '💬', enabled: true },
            { id: 'current_offers', group: 'sales', label: 'Current Offers & Discounts', icon: '🏷️', enabled: true },
            { id: 'best_sellers', group: 'sales', label: 'Best Sellers / Trending', icon: '🔥', enabled: true },
            { id: 'size_guide', group: 'sales', label: 'Size Guide & Fit Help', icon: '📏', enabled: true },
            { id: 'gift_ideas', group: 'sales', label: 'Gift Ideas & Collections', icon: '🎁', enabled: true }
          ];
        }

        const isPillEnabled = (p) => p && p.enabled !== false && p.enabled !== 'false' && p.enabled !== 0 && p.enabled !== '0';
        const enabledPills = pills.filter(isPillEnabled);
        const supportPills = enabledPills.filter(p => p.group === 'support' || ['track_order', 'return_policy', 'shipping_delivery', 'whatsapp_support'].includes(p.id));
        const salesPills = enabledPills.filter(p => p.group === 'sales' || ['current_offers', 'best_sellers', 'size_guide', 'gift_ideas'].includes(p.id));

        const renderPillItem = (p) => `
          <button type="button" class="welcome-pill" data-pill-id="${escapeAttr(p.id)}" data-pill-label="${escapeAttr(p.label || '')}" data-pill-url="${escapeAttr(p.url || '')}" data-pill-image="${escapeAttr(p.image_url || '')}">
            <span class="pill-icon">${p.icon || '✨'}</span>
            <span class="pill-label">${escapeAttr(p.label || '')}</span>
          </button>
        `;

        return `
          <div class="welcome-wrap">
            <div class="welcome-hero-box">
              <h3>Welcome!</h3>
              <p>${greeting}</p>
              <button class="btn" id="btn-start">Get Started</button>
            </div>

            ${enabledPills.length > 0 ? `
              <div class="welcome-pills-section">
                ${supportPills.length > 0 ? `
                  <div class="welcome-pill-group">
                    <div class="pill-group-title">🛠️ Support & Order Help</div>
                    <div class="pill-grid">
                      ${supportPills.map(renderPillItem).join('')}
                    </div>
                  </div>
                ` : ''}

                ${salesPills.length > 0 ? `
                  <div class="welcome-pill-group">
                    <div class="pill-group-title">🛍️ Explore & Shopping</div>
                    <div class="pill-grid">
                      ${salesPills.map(renderPillItem).join('')}
                    </div>
                  </div>
                ` : ''}
              </div>
            ` : ''}
          </div>
        `;
      } 
      
      if (this.state.view === 'lead-capture') {
        const countryCode = (widgetConfig?.country_code || 'IN').toUpperCase();
        const isIndia = countryCode === 'IN';
        const phonePlaceholder = isIndia ? '+91 98765 43210' : '+44 7000 000000';
        const phoneLabel = isIndia ? 'WhatsApp / Phone Number (🇮🇳 +91)' : 'Phone Number (Optional)';

        return `
          <h3>Let's get started</h3>
          <p>Please provide your email to continue. This helps us save your recommendations and exclusive discounts.</p>
          
          <form id="lead-form">
            <div class="form-group">
              <label for="email">Email Address (Required)</label>
              <input type="email" id="email" required placeholder="you@example.com" />
            </div>
            
            <div class="form-group">
              <label for="phone">${phoneLabel}</label>
              <input type="tel" id="phone" placeholder="${phonePlaceholder}" />
              ${isIndia ? '<small style="font-size: 11px; color: #64748b; margin-top: 3px; display: block;">Enter 10-digit mobile number for order & discount updates</small>' : ''}
            </div>
            
            <div class="checkbox-group">
              <input type="checkbox" id="marketing" checked />
              <label for="marketing">
                Keep me updated with news, AI recommendations, and exclusive offers.
              </label>
            </div>
            
            <button type="submit" class="btn">Continue to Chat</button>
            <button type="button" class="btn btn-back-options" id="btn-back-welcome" style="margin-top: 10px; background: #ffffff; color: #475569; border: 1.5px solid #cbd5e1; box-shadow: none; display: flex; align-items: center; justify-content: center; gap: 6px;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
              <span>Back to Options</span>
            </button>
          </form>
          
          <div class="policy-link">
            <a href="${policyUrl}" target="_blank">Privacy Policy</a>
          </div>
        `;
      }
      
      if (this.state.view === 'chat') {
        // The ticket card uses the brand colours; they are defined in render(), not in this method
        const primaryColor = this.state.config?.widget?.primary_colour || '#4f46e5';
        const secondaryColor = this.state.config?.widget?.secondary_colour || '#ffffff';
        const messagesHtml = this.state.messages.map((m, mIdx) => {
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
            const carouselId = 'car_' + mIdx + '_' + Math.random().toString(36).substr(2, 5);
            const totalRecs = recs.length;

            recsHtml = `
              <div class="product-carousel-wrapper" data-carousel-id="${carouselId}">
                ${totalRecs > 1 ? `<button type="button" class="carousel-nav-btn prev" aria-label="Previous Products">❮</button>` : ''}
                <div class="product-carousel-track" id="${carouselId}">
            ` + recs.map(r => {
              const rawPrice = r.price !== undefined ? parseFloat(r.price) : 0;
              const comparePrice = r.compare_at_price ? parseFloat(r.compare_at_price) : 0;
              const hasRealCompare = comparePrice > rawPrice;
              const catalogDiscount = hasRealCompare ? Math.round(((comparePrice - rawPrice) / comparePrice) * 100) : 0;

              const offerCode = widgetConfig?.offer_code || '';
              const offerPercent = Number(widgetConfig?.offer_discount_percent || 0);
              const hasOffer = Boolean(offerCode && offerPercent > 0);
              const specialAiPrice = hasOffer ? (rawPrice * (1 - offerPercent / 100)).toFixed(0) : '';

              const priceDisplay = formatCurrencyPrice(rawPrice, r.currency);
              const trackingUrl = buildUtmProductUrl(r.product_url, this.sessionId, this.visitorId, this.storeId);
              const inStock = r.in_stock !== false;
              const imgUrl = r.image_url || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&q=80';
              // Badge only reflects real Shopify BEST_SELLING rank from the catalog sync (top 25 are flagged)
              const salesRank = Number(r.sales_rank) || 999;
              let popularBadge = '';
              if (salesRank <= 3) popularBadge = `🔥 Best Seller #${salesRank}`;
              else if (salesRank <= 10) popularBadge = '🔥 Best Seller';
              else if (r.is_bestseller) popularBadge = '⭐ Trending';

              return `
                <div class="product-card">
                  <div class="product-card-thumb-wrap">
                    <img src="${imgUrl}" alt="${r.title || 'Product'}" class="product-card-thumb" loading="lazy" />
                    ${popularBadge ? `<span class="product-badge-popular">${popularBadge}</span>` : ''}
                    <span class="${inStock ? 'product-badge-stock' : 'product-badge-out'}">
                      ${inStock ? 'In Stock' : 'Out of Stock'}
                    </span>
                  </div>
                  <div class="product-card-info">
                    <h4 class="product-card-title" title="${r.title || ''}">${r.title || 'Product'}</h4>
                    <div class="product-card-price-row">
                      <span class="product-card-price">${priceDisplay}</span>
                      ${hasRealCompare ? `
                        <span class="product-card-compare-price">${formatCurrencyPrice(comparePrice, r.currency)}</span>
                        <span class="product-card-discount-tag">${catalogDiscount}% OFF</span>
                      ` : ''}
                    </div>

                    ${hasOffer ? `
                      <div class="ai-special-badge" data-code="${offerCode}">
                        <div class="ai-badge-top">
                          <span class="ai-badge-star">✨</span>
                          <span class="ai-badge-label">AI Special:</span>
                          <strong class="ai-badge-price">${formatCurrencyPrice(specialAiPrice, r.currency)}</strong>
                        </div>
                        <div class="ai-coupon-row">
                          <span class="ai-coupon-code">${offerCode}</span>
                          <button type="button" class="btn-copy-coupon" data-code="${offerCode}" title="Click to copy for checkout / Razorpay">
                            📋 Copy
                          </button>
                        </div>
                      </div>
                    ` : ''}

                    <div class="product-card-btn-group">
                      <a href="${trackingUrl}" target="_blank" class="btn-view-product" 
                         data-product-id="${r.product_id || r.productId || ''}" 
                         data-title="${encodeURIComponent(r.title || '')}"
                         data-url="${encodeURIComponent(trackingUrl)}"
                         data-offer-code="${offerCode}">
                        View Product ↗
                      </a>
                      <button type="button" class="btn-add-to-cart" 
                              data-variant-id="${r.variant_id || r.variantId || ''}" 
                              data-product-id="${r.product_id || r.productId || ''}" 
                              data-title="${encodeURIComponent(r.title || '')}" 
                              data-price="${rawPrice}" 
                              data-currency="${r.currency || 'INR'}"
                              data-product-url="${encodeURIComponent(trackingUrl)}"
                              data-offer-code="${offerCode}">
                        Add to Cart 🛒
                      </button>
                    </div>
                  </div>
                </div>
              `;
            }).join('') + `
                </div>
                ${totalRecs > 1 ? `<button type="button" class="carousel-nav-btn next" aria-label="Next Products">❯</button>` : ''}
              </div>
              ${totalRecs > 1 ? `
                <div class="carousel-dots-indicator" data-carousel-id="${carouselId}">
                  ${recs.map((_, i) => `<span class="carousel-dot ${i === 0 ? 'active' : ''}" data-index="${i}"></span>`).join('')}
                </div>
              ` : ''}
            `;
          }

          let ticketCardHtml = '';
          if (m.isTicketPrompt) {
            if (m.isTicketSubmitted) {
              ticketCardHtml = `
                <div style="margin-top: 8px; background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.4); border-radius: 8px; padding: 12px; color: #10b981; font-size: 12px;">
                  <strong style="color: #059669; font-size: 13px;">✅ Support Ticket Created (#${escapeAttr(m.submittedTicketId || '').substring(0, 8).toUpperCase()})</strong><br/>
                  <span style="font-size: 12px; color: #334155; display: block; margin-top: 6px; line-height: 1.5;">Our store support team has received your chat transcript and will email a resolution to <strong>${escapeAttr(m.submittedEmail || '')}</strong> ${escapeAttr(m.revertDuration || 'within 24 hours')}.</span>
                </div>
              `;
            } else {
              const defaultEmail = m.ticketEmail || this.visitorEmail || this.readStored('ai_visitor_email') || '';
              const revertDur = m.revertDuration || this.ticketRevertDuration || 'within 24 hours';
              ticketCardHtml = `
                <div class="ticket-escalation-card" style="margin-top: 8px; background: #ffffff; border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.06);">
                  <div style="font-weight: 600; font-size: 12px; color: #0f172a; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
                    <span>🛎️ Open Support Ticket</span>
                  </div>
                  <p style="font-size: 11px; color: #64748b; margin: 0 0 8px 0; line-height: 1.4;">
                    Please confirm your email so our human support team can inspect this chat and email you a full solution <strong>${escapeAttr(revertDur)}</strong>.
                  </p>
                  <div style="display: flex; flex-direction: column; gap: 6px;">
                    <input type="email" class="input-escalation-email" data-msg-idx="${mIdx}" placeholder="Enter your email address" value="${escapeAttr(defaultEmail)}" style="width: 100%; box-sizing: border-box; padding: 7px 10px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 12px; color: #0f172a; background: #f8fafc;" />
                    <button type="button" class="btn-submit-ticket" data-msg-idx="${mIdx}" style="background: ${primaryColor}; color: ${secondaryColor}; border: none; border-radius: 6px; padding: 8px 12px; font-size: 12px; font-weight: 600; cursor: pointer; transition: opacity 0.2s;">
                      Submit Ticket to Support Team
                    </button>
                  </div>
                </div>
              `;
            }
          }

          return `
            <div class="msg ${m.role}">
              <div class="msg-text">${formatChatContent(displayText)}</div>
              ${recsHtml}
              ${ticketCardHtml}
            </div>
          `;
        }).join('');

        const isWaiting = this.state.messages.length > 0 && this.state.messages[this.state.messages.length - 1].isLoading;

        return `
          <div class="chat-area">
            <div class="chat-messages" style="overflow-y: auto;">
              ${messagesHtml}
            </div>
            <div class="chat-action-pills-bar">
              <button type="button" class="btn-need-help-chip" id="btn-quick-need-help" title="Need Human Support? Open Ticket">
                <span>🛎️ Need Human Help? Open Ticket</span>
              </button>
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
      const nudge = this.shadowRoot.getElementById('proactive-nudge');
      
      if (launcher) {
        launcher.addEventListener('click', () => {
          this.hideProactiveNudge();
          const nextState = !this.state.isOpen;
          this.setState({ isOpen: nextState });
          if (nextState) {
            this.trackEvent('widget_opened');
          }
        });

        // 3D Tilt micro-interaction on hover
        launcher.addEventListener('mousemove', (e) => {
          const rect = launcher.getBoundingClientRect();
          const x = e.clientX - rect.left - rect.width / 2;
          const y = e.clientY - rect.top - rect.height / 2;
          launcher.style.transform = `perspective(500px) rotateX(${-y * 0.1}deg) rotateY(${x * 0.1}deg) translateY(-3px) scale(1.02)`;
        });
        launcher.addEventListener('mouseleave', () => {
          launcher.style.transform = '';
        });
      }

      if (nudge) {
        nudge.addEventListener('click', (e) => {
          if (e.target.closest('.nudge-close-btn')) {
            e.stopPropagation();
            this.hideProactiveNudge();
            return;
          }
          this.hideProactiveNudge();
          this.setState({ isOpen: true });
          this.trackEvent('widget_opened', { source: 'proactive_nudge' });
        });
      }
      
      const btnMinimize = this.shadowRoot.querySelector('.btn-minimize');
      const btnClose = this.shadowRoot.querySelector('.btn-close');
      const closeLegacyBtn = this.shadowRoot.querySelector('.close-btn');

      const handleClose = () => {
        this.setState({ isOpen: false });
      };

      if (btnMinimize) btnMinimize.addEventListener('click', handleClose);
      if (btnClose) btnClose.addEventListener('click', handleClose);
      if (closeLegacyBtn) closeLegacyBtn.addEventListener('click', handleClose);

      // Header Human Support Ticket Button
      const btnHumanTicket = this.shadowRoot.querySelector('.btn-human-ticket');
      if (btnHumanTicket) {
        btnHumanTicket.addEventListener('click', (e) => {
          e.preventDefault();
          this.openTicketEscalationPrompt('Customer requested human support via header button');
        });
      }

      // In-Chat Quick Action Chip
      const btnQuickNeedHelp = this.shadowRoot.getElementById('btn-quick-need-help');
      if (btnQuickNeedHelp) {
        btnQuickNeedHelp.addEventListener('click', (e) => {
          e.preventDefault();
          this.openTicketEscalationPrompt('Customer requested human support via in-chat action chip');
        });
      }

      // Inline Ticket Submit Buttons
      this.shadowRoot.querySelectorAll('.btn-submit-ticket').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          const idx = parseInt(btn.getAttribute('data-msg-idx'), 10);
          const card = btn.closest('.ticket-escalation-card');
          const emailInput = card ? card.querySelector('.input-escalation-email') : null;
          const email = emailInput ? emailInput.value.trim() : '';
          const originalText = btn.textContent;
          btn.disabled = true;
          btn.textContent = 'Submitting Ticket...';
          try {
            await this.submitSupportTicket(email, 'Customer inquiry escalation', idx);
          } finally {
            btn.disabled = false;
            btn.textContent = originalText;
          }
        });
      });

      const btnStart = this.shadowRoot.getElementById('btn-start');
      if (btnStart) {
        btnStart.addEventListener('click', async () => {
          if (!this.sessionId) {
            const anonymousId = 'anon_' + Math.random().toString(36).substr(2, 9);
            await this.startSession(anonymousId);
          }
          this.setState({ pendingPill: null, view: 'lead-capture' });
        });
      }

      // Quick Action Pills Click Listeners (Consent-Gated)
      this.shadowRoot.querySelectorAll('.welcome-pill').forEach(pillBtn => {
        pillBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          const pillId = pillBtn.getAttribute('data-pill-id');
          const pillLabel = pillBtn.getAttribute('data-pill-label');
          const pillUrl = pillBtn.getAttribute('data-pill-url');
          const pillImage = pillBtn.getAttribute('data-pill-image');

          if (!this.sessionId) {
            const anonymousId = 'anon_' + Math.random().toString(36).substr(2, 9);
            await this.startSession(anonymousId);
          }

          // If visitor already consented earlier, directly go to chat and trigger action
          const existingEmail = this.visitorEmail || this.readStored('ai_visitor_email');
          if (existingEmail) {
            const greeting = this.state.config?.widget?.greeting || 'Hello! How can I help you today?';
            const initMessages = this.state.messages.length > 0 ? this.state.messages : [{ role: 'assistant', content: greeting }];
            this.setState({
              view: 'chat',
              pendingPill: null,
              messages: initMessages
            });
            setTimeout(() => {
              if (pillId === 'whatsapp_support') {
                this.openTicketEscalationPrompt('Customer requested WhatsApp / Human Support');
              } else {
                this.sendMessage(pillLabel);
              }
            }, 300);
            return;
          }

          // Gated by consent: Store pending pill and prompt for email/phone
          this.setState({
            pendingPill: {
              id: pillId,
              label: pillLabel,
              url: pillUrl,
              image_url: pillImage
            },
            view: 'lead-capture'
          });
        });
      });

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

      // Back to Options handlers (returns shopper from lead-capture to welcome screen)
      const handleBackToOptions = (e) => {
        if (e) e.preventDefault();
        this.setState({
          pendingPill: null,
          view: 'welcome'
        });
        try {
          sessionStorage.setItem('ai_widget_view', 'welcome');
        } catch (_) {}
      };

      const btnBackWelcome = this.shadowRoot.getElementById('btn-back-welcome');
      if (btnBackWelcome) {
        btnBackWelcome.addEventListener('click', handleBackToOptions);
      }

      const headerBtnBack = this.shadowRoot.getElementById('header-btn-back');
      if (headerBtnBack) {
        headerBtnBack.addEventListener('click', handleBackToOptions);
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
        
        // Focus input on load ONLY on desktop (Prevents mobile screen zoom)
        setTimeout(() => {
          const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
          if (window.innerWidth > 768 && !isTouch) {
            const input = this.shadowRoot.getElementById('chat-input-text');
            if (input && !input.disabled) {
              input.focus();
            }
          }
        }, 150);
      }

      // Carousel navigation prev / next and dot indicators
      this.shadowRoot.querySelectorAll('.product-carousel-wrapper').forEach(wrapper => {
        const track = wrapper.querySelector('.product-carousel-track');
        const prevBtn = wrapper.querySelector('.carousel-nav-btn.prev');
        const nextBtn = wrapper.querySelector('.carousel-nav-btn.next');
        const carouselId = wrapper.getAttribute('data-carousel-id');
        const dots = this.shadowRoot.querySelectorAll(`.carousel-dots-indicator[data-carousel-id="${carouselId}"] .carousel-dot`);

        if (track && prevBtn) {
          prevBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            track.scrollBy({ left: -230, behavior: 'smooth' });
          });
        }
        if (track && nextBtn) {
          nextBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            track.scrollBy({ left: 230, behavior: 'smooth' });
          });
        }
        if (track && dots.length > 0) {
          track.addEventListener('scroll', () => {
            const cardWidth = 230;
            const activeIndex = Math.min(dots.length - 1, Math.max(0, Math.round(track.scrollLeft / cardWidth)));
            dots.forEach((dot, idx) => {
              if (idx === activeIndex) dot.classList.add('active');
              else dot.classList.remove('active');
            });
          });
          dots.forEach(dot => {
            dot.addEventListener('click', () => {
              const idx = parseInt(dot.getAttribute('data-index') || '0', 10);
              track.scrollTo({ left: idx * 230, behavior: 'smooth' });
            });
          });
        }
      });

      // 1-Click Copy Coupon Code buttons (Razorpay / Custom Checkout compatible)
      this.shadowRoot.querySelectorAll('.btn-copy-coupon').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const code = btn.getAttribute('data-code');
          if (code) {
            try {
              await navigator.clipboard.writeText(code);
            } catch (_) {}
            btn.textContent = '✓ Copied!';
            btn.classList.add('copied');
            this.showToast(`🎉 Code ${code} copied! Paste at checkout / Razorpay.`);
            setTimeout(() => {
              btn.textContent = '📋 Copy';
              btn.classList.remove('copied');
            }, 2500);
          }
        });
      });

      // Attach click events for product card "View Product" buttons
      this.shadowRoot.querySelectorAll('.btn-view-product').forEach(btn => {
        btn.addEventListener('click', async () => {
          const prodId = btn.getAttribute('data-product-id');
          const title = decodeURIComponent(btn.getAttribute('data-title') || '');
          const url = decodeURIComponent(btn.getAttribute('data-url') || '');
          const offerCode = btn.getAttribute('data-offer-code');

          if (offerCode) {
            try {
              await navigator.clipboard.writeText(offerCode);
              this.showToast(`🏷️ Code ${offerCode} copied for your checkout!`);
            } catch (_) {}
          }

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
          const offerCode = btn.getAttribute('data-offer-code');

          if (offerCode) {
            try {
              await navigator.clipboard.writeText(offerCode);
              this.showToast(`🏷️ Code ${offerCode} copied for your checkout!`);
            } catch (_) {}
          }

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
    
    let widgetKey = script?.getAttribute('data-widget-key') || script?.getAttribute('data-key') || '';
    let storeId = script?.getAttribute('data-store-id') || script?.getAttribute('data-store') || '';

    if ((!widgetKey || !storeId) && script?.src) {
      try {
        const parsedUrl = new URL(script.src, window.location.href);
        if (!widgetKey) widgetKey = parsedUrl.searchParams.get('widget_key') || parsedUrl.searchParams.get('key') || '';
        if (!storeId) storeId = parsedUrl.searchParams.get('store_id') || parsedUrl.searchParams.get('storeId') || parsedUrl.searchParams.get('store') || '';
      } catch (_) {}
    }

    if (!widgetKey) widgetKey = window.AI_SMART_ENGINE_KEY || window.__ai_widget_key || '';
    if (!storeId) storeId = window.AI_SMART_ENGINE_STORE_ID || window.__ai_store_id || '';

    const el = document.createElement('ai-shopping-assistant');
    if (widgetKey) el.setAttribute('data-widget-key', widgetKey);
    if (storeId) el.setAttribute('data-store-id', storeId);
    // Ensure host element never captures clicks or displaces page layout
    el.style.cssText = 'position: fixed !important; bottom: 0 !important; right: 0 !important; z-index: 2147483647 !important; pointer-events: none !important; border: none !important; margin: 0 !important; padding: 0 !important; width: 0 !important; height: 0 !important; overflow: visible !important; display: block !important;';
    
    if (document.body) {
      document.body.appendChild(el);
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        if (!document.querySelector('ai-shopping-assistant') && document.body) {
          document.body.appendChild(el);
        }
      });
    }
  }

  // Storefront attribution listener & cart attributes sync
  function hookStorefrontCartEvents() {
    try {
      const params = new URLSearchParams(window.location.search);
      const aiSid = params.get('ai_sid');
      const aiVid = params.get('ai_vid');
      const utmSource = params.get('utm_source');
      const utmMedium = params.get('utm_medium');
      const utmCampaign = params.get('utm_campaign');
      const utmContent = params.get('utm_content');
      const utmTerm = params.get('utm_term');
      const fbclid = params.get('fbclid');
      const gclid = params.get('gclid');
      const ttclid = params.get('ttclid');

      if (aiSid) { try { sessionStorage.setItem('ai_session_id', aiSid); localStorage.setItem('ai_session_id', aiSid); } catch (_) {} }
      if (aiVid) { try { sessionStorage.setItem('ai_visitor_id', aiVid); localStorage.setItem('ai_visitor_id', aiVid); } catch (_) {} }
      if (utmSource) { try { sessionStorage.setItem('ai_utm_source', utmSource); } catch (_) {} }
      if (utmMedium) { try { sessionStorage.setItem('ai_utm_medium', utmMedium); } catch (_) {} }
      if (utmCampaign) { try { sessionStorage.setItem('ai_utm_campaign', utmCampaign); } catch (_) {} }
      if (utmContent) { try { sessionStorage.setItem('ai_utm_content', utmContent); } catch (_) {} }
      if (utmTerm) { try { sessionStorage.setItem('ai_utm_term', utmTerm); } catch (_) {} }
      if (fbclid) { try { sessionStorage.setItem('ai_fbclid', fbclid); } catch (_) {} }
      if (gclid) { try { sessionStorage.setItem('ai_gclid', gclid); } catch (_) {} }
      if (ttclid) { try { sessionStorage.setItem('ai_ttclid', ttclid); } catch (_) {} }


      const activeSid = aiSid || sessionStorage.getItem('ai_session_id') || localStorage.getItem('ai_session_id');
      const activeVid = aiVid || sessionStorage.getItem('ai_visitor_id') || localStorage.getItem('ai_visitor_id');
      if (activeSid && activeVid) {
        syncShopifyCartAttributes(activeSid, activeVid);
      }

      // Safe storefront fetch interception:
      // CRITICAL: MUST execute on 'window' context, otherwise strict mode/ES modules call with this===undefined
      // and throws "TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation", crashing all theme scripts!
      const origFetch = window.fetch;
      if (origFetch && typeof origFetch === 'function' && !window.__aiFetchHooked) {
        window.__aiFetchHooked = true;
        window.fetch = function (...args) {
          return origFetch.apply(window, args).then(res => {
            try {
              const firstArg = args[0];
              const url = typeof firstArg === 'string' ? firstArg : (firstArg && firstArg.url ? firstArg.url : '');
              if (url && (url.includes('/cart/add') || url.includes('/cart/add.js'))) {
                try {
                  if (res && typeof res.clone === 'function') {
                    const clone = res.clone();
                    clone.json().then(item => {
                      const widgetEl = document.querySelector('ai-shopping-assistant');
                      if (widgetEl && typeof widgetEl.trackEvent === 'function') {
                        widgetEl.trackEvent('add_to_cart', {
                          title: item.title || item.product_title || 'Storefront Item',
                          price: item.price ? (item.price / 100).toFixed(2) : undefined,
                          currency: item.currency || 'INR',
                          source: 'storefront_theme'
                        });
                      }
                    }).catch(() => {
                      const widgetEl = document.querySelector('ai-shopping-assistant');
                      if (widgetEl && typeof widgetEl.trackEvent === 'function') {
                        widgetEl.trackEvent('add_to_cart', {
                          title: 'Storefront Item',
                          source: 'storefront_theme'
                        });
                      }
                    });
                  }
                } catch (_) {}
              }
            } catch (_) {}
            return res;
          });
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
