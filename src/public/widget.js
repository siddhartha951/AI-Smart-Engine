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
      
      this.renderInit();
      await this.loadConfig();
      if (this.state.config) {
        this.render();
      }
    }

    async trackEvent(type, payload = {}) {
      if (!this.visitorId) return;
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

    setState(newState) {
      this.state = { ...this.state, ...newState };
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
          font-size: 16px;
          font-weight: bold;
          cursor: pointer;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          transition: transform 0.2s ease;
        }
        
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

        .product-card {
          background: #fff;
          border: 1px solid #eaeaea;
          border-radius: 8px;
          padding: 10px;
          display: flex;
          gap: 10px;
          align-items: flex-start;
          box-shadow: 0 2px 4px rgba(0,0,0,0.05);
        }

        .product-card img {
          width: 60px;
          height: 60px;
          object-fit: cover;
          border-radius: 4px;
          background: #f9f9f9;
        }

        .product-card-details {
          flex: 1;
        }

        .product-card-title {
          font-size: 14px;
          font-weight: bold;
          margin-bottom: 4px;
          color: #333;
        }

        .product-card-price {
          font-size: 13px;
          color: #666;
          margin-bottom: 8px;
        }

        .product-card a {
          display: inline-block;
          background: ${primaryColor};
          color: ${secondaryColor};
          text-decoration: none;
          padding: 6px 12px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: bold;
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
      const { widget: widgetConfig, assistant: assistantConfig } = this.state.config;
      
      const buttonText = widgetConfig?.button_text || 'Ask our shopping assistant';
      const greeting = widgetConfig?.greeting || 'Hello! How can I help you today?';
      const assistantName = assistantConfig?.assistant_name || 'Assistant';
      const policyUrl = assistantConfig?.privacy_policy_url || '#';

      this.shadowRoot.innerHTML = `
        <style>${this.getStyles()}</style>
        <div id="widget-container">
          <div id="popup" class="${this.state.isOpen ? 'open' : ''}">
            <div class="header">
              <span>${assistantName}</span>
              <button class="close-btn">&times;</button>
            </div>
            
            <div class="content">
              ${this.renderView(greeting, policyUrl)}
            </div>
          </div>
          
          <button id="launcher">
            ${this.state.isOpen ? 'Close' : buttonText}
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
          let recsHtml = '';
          if (m.recommendations && m.recommendations.length > 0) {
            recsHtml = '<div class="product-list">' + m.recommendations.map(r => `
              <div class="product-card">
                <div class="product-card-details">
                  <div class="product-card-title">${r.title}</div>
                  <div class="product-card-price">${r.currency} ${r.price}</div>
                  <a href="#" target="_blank">Add to Cart</a>
                </div>
              </div>
            `).join('') + '</div>';
          }
          return `
            <div class="msg ${m.role}">
              ${m.content}
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoMountWidget);
  } else {
    autoMountWidget();
  }
})();
