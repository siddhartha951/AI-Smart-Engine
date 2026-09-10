# Merchant Installation Guide: Shopify AI Shopping Assistant

Welcome to the AI Shopping Assistant pilot! Follow this simple step-by-step guide to install the assistant widget on your Shopify online store. No coding skills are required.

---

## What You Need Before You Begin
1. Your unique **Widget Script Code** provided in your Onboarding completion email or Onboarding Wizard Step 4:
   ```html
   <script src="https://<YOUR-DOMAIN>/widget.js" data-widget-key="<YOUR-WIDGET-KEY>" defer></script>
   ```
2. Admin access to your Shopify store (`admin.shopify.com/store/<your-store-name>`).

---

## Step 1: Open Your Shopify Theme Code Editor
1. Log in to your **Shopify Admin** dashboard.
2. In the left-hand menu, navigate to **Sales Channels** -> **Online Store** -> **Themes**.
3. Under **Current theme**, click the **`...`** (three dots) button next to "Customize".
4. Click **Edit code**.

![Theme Edit Code Navigation](https://help.shopify.com/assets/manual/online-store/themes/theme-code-editor.png)

---

## Step 2: Paste the Script in `theme.liquid`
1. In the file list on the left side, look under the **Layout** folder.
2. Click on **`theme.liquid`** to open it in the code editor.
3. Look for the closing `</head>` tag (you can press `Ctrl + F` or `Cmd + F` and search for `</head>`).
4. Paste your widget script tag **directly on the line right above `</head>`**:

```html
  <!-- AI Shopping Assistant Widget Start -->
  <script src="https://<YOUR-DOMAIN>/widget.js" data-widget-key="<YOUR-WIDGET-KEY>" defer></script>
  <!-- AI Shopping Assistant Widget End -->
</head>
```

5. Click **Save** in the top-right corner.

---

## Step 3: Verify the Widget on Your Live Store
1. Open your live Shopify store in a new browser tab or on your mobile phone.
2. Look at the bottom-right corner of your screen:
   - You will see the floating chat button.
   - Click it to ensure the welcome message and assistant panel open smoothly.
3. If the button does not appear immediately:
   - Perform a **Hard Refresh** (`Ctrl + F5` on Windows or `Cmd + Shift + R` on Mac) to clear any cached theme files.

---

## How to Pause the Assistant Instantly
If at any time during the pilot you want to pause or disable the assistant:
1. Log in to your **Merchant Dashboard** at `https://<YOUR-DOMAIN>/dashboard/index.html`.
2. Toggle the **"Assistant Status"** switch to **Paused**.
3. The widget on your store will immediately stop opening, without requiring you to remove any theme code.
