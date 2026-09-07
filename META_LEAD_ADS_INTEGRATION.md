# Meta Lead Ads Integration Guide (HiveRift CRM)

This guide documents the setup, environment configuration, Webhook subscription, testing, and production verification for the **Meta / Facebook / Instagram Lead Ads** integration in HiveRift CRM.

---

## 1. Flow Overview

```text
Facebook / Instagram Lead Ad
        ↓
Meta Instant Form (User submits details)
        ↓
Meta Realtime Webhook (`leadgen` event)
        ↓
HiveRift NestJS (`POST /api/v1/meta/webhook`)
        ↓
Signature Verification (`X-Hub-Signature-256` HMAC SHA-256)
        ↓
Extract `leadgen_id`
        ↓
Meta Graph API (`GET /{version}/{leadgen_id}`)
        ↓
Idempotency & Duplicate Check (`metaLeadId`, `phone`, `email`)
        ↓
Existing Lead Collection (`source = META`, `status = new`)
        ↓
HiveRift Sales Pipeline & Admin Realtime Notification
```

---

## 2. Environment Variables

Add the following environment variables to your `.env` file on the server running `backend-crm`:

```env
# ===============================
# META LEAD ADS CONFIGURATION
# ===============================
META_APP_ID=your_meta_app_id
META_APP_SECRET=your_meta_app_secret
META_PAGE_ID=your_meta_page_id
META_PAGE_ACCESS_TOKEN=your_meta_page_access_token
META_WEBHOOK_VERIFY_TOKEN=your_random_secret_verify_token
META_GRAPH_API_VERSION=v26.0
```

> [!CAUTION]
> - **Never commit real secrets** to git repository or frontend code.
> - `META_WEBHOOK_VERIFY_TOKEN` is a secret string created by you for Meta Webhook GET verification.
> - `META_APP_SECRET` is used to verify HMAC SHA-256 request signatures sent by Meta in `X-Hub-Signature-256`.

---

## 3. Meta Developer App Setup Steps

1. **Create or Open Meta App**:
   - Go to [Meta for Developers](https://developers.facebook.com/).
   - Create a Business App or use an existing app.
   - Use Case: **Capture & manage ad leads with Marketing API** (or Lead Access / Webhooks).

2. **Add Products**:
   - Add **Webhooks** product to your app.
   - Add **Facebook Login / Page Permissions** if required.

3. **Configure Webhook Callback**:
   - Select Object: **Page**.
   - Callback URL: `https://your-domain.com/api/v1/meta/webhook` (or `https://hiveriftdesk.online/hiveriftCRM-backend/api/v1/meta/webhook`).
   - Verify Token: The exact string configured in `META_WEBHOOK_VERIFY_TOKEN`.
   - Click **Verify and Save**.

4. **Subscribe to Leadgen Field**:
   - Under Page Webhook subscriptions, find `leadgen` field.
   - Click **Subscribe**.

5. **Generate Page Access Token**:
   - Go to Meta Tools / Graph API Explorer or Access Token Tool.
   - Select your Facebook Page (`META_PAGE_ID`).
   - Grant permissions: `leads_retrieval`, `pages_show_list`, `pages_read_engagement`, `pages_manage_ads`.
   - Generate a **Never-Expiring Page Access Token** and set it as `META_PAGE_ACCESS_TOKEN`.

---

## 4. API Endpoints Reference

### GET `/api/v1/meta/webhook`
- **Access**: Public (Meta Verification)
- **Parameters**: `hub.mode`, `hub.verify_token`, `hub.challenge`
- **Response**: `hub.challenge` (Plaintext string if token matches)

### POST `/api/v1/meta/webhook`
- **Access**: Public (Secured via `X-Hub-Signature-256`)
- **Header**: `X-Hub-Signature-256: sha256=<hmac_sha256_hash>`
- **Payload Example**:
```json
{
  "object": "page",
  "entry": [
    {
      "id": "PAGE_ID",
      "time": 1725700000,
      "changes": [
        {
          "field": "leadgen",
          "value": {
            "leadgen_id": "495820194829105",
            "page_id": "PAGE_ID",
            "form_id": "FORM_ID",
            "ad_id": "AD_ID",
            "adgroup_id": "ADSET_ID",
            "campaign_id": "CAMPAIGN_ID"
          }
        }
      ]
    }
  ]
}
```
- **Response**: `{ "success": true }` (HTTP 200)

### POST `/api/v1/meta/test-ingest`
- **Access**: Protected (JWT + Admin / Management Role)
- **Payload Example**:
```json
{
  "leadgen_id": "495820194829105",
  "page_id": "1002030405",
  "form_id": "2003040506",
  "ad_id": "3004050607"
}
```
- **Response**: Returns the created/enriched CRM Lead document.

---

## 5. Testing with Meta Lead Ads Testing Tool

1. Go to [Meta Lead Ads Testing Tool](https://developers.facebook.com/tools/lead-ads-testing/).
2. Select your Facebook Page and Lead Form.
3. Click **Create Lead**.
4. Click **Track Status** to verify that Meta dispatched the webhook to your callback URL and received HTTP 200.
5. Check your HiveRift CRM Leads table to confirm the lead appears with `Source: META`.
