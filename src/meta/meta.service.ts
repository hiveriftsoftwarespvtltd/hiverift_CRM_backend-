import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { META_CONSTANTS } from './constants/meta.constants';
import { MetaLeadGraphResponse } from './interfaces/meta.interface';

@Injectable()
export class MetaService {
  private readonly logger = new Logger(MetaService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Fetches lead details from Meta Graph API using leadgen_id
   * GET /{version}/{leadgen_id}?access_token={page_access_token}
   */
  async getLeadDetails(leadgenId: string): Promise<MetaLeadGraphResponse | null> {
    const pageAccessToken = this.configService.get<string>('META_PAGE_ACCESS_TOKEN');
    const apiVersion = this.configService.get<string>('META_GRAPH_API_VERSION') || META_CONSTANTS.DEFAULT_GRAPH_API_VERSION;

    if (!pageAccessToken || pageAccessToken.includes('your_meta_page_access_token')) {
      this.logger.warn(`META_PAGE_ACCESS_TOKEN is not configured. Skipping Graph API fetch for leadgen_id: ${leadgenId}`);
      return null;
    }

    const url = `${META_CONSTANTS.GRAPH_API_BASE_URL}/${apiVersion}/${leadgenId}?access_token=${encodeURIComponent(pageAccessToken)}`;

    const maxRetries = 2;
    let attempt = 0;

    while (attempt < maxRetries) {
      attempt++;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

      try {
        this.logger.log(`Fetching Meta Lead Details for leadgen_id=${leadgenId} (Attempt ${attempt}/${maxRetries})`);
        
        const response = await fetch(url, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorJson = await response.json().catch(() => ({}));
          const errorMsg = errorJson?.error?.message || `HTTP ${response.status} ${response.statusText}`;
          this.logger.error(`Meta Graph API Error for leadgen_id=${leadgenId}: ${errorMsg} (Code: ${errorJson?.error?.code || 'N/A'})`);

          // Rate limit or transient error - retry once
          if ((response.status >= 500 || response.status === 429) && attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, 1000 * attempt));
            continue;
          }

          return null;
        }

        const data: MetaLeadGraphResponse = await response.json();
        this.logger.log(`Successfully retrieved Meta Lead data for leadgen_id=${leadgenId}`);
        return data;
      } catch (err: any) {
        clearTimeout(timeoutId);
        const isAbort = err?.name === 'AbortError';
        const msg = isAbort ? 'Request Timeout (10s)' : (err?.message || 'Network Failure');
        
        this.logger.error(`Meta Graph API Request Failed for leadgen_id=${leadgenId}: ${msg}`);

        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
          continue;
        }

        return null;
      }
    }

    return null;
  }

  /**
   * Sends a WhatsApp text message to a customer via Meta WhatsApp Cloud API
   * POST /{version}/{phone_number_id}/messages
   */
  async sendWhatsAppTextMessage(phone: string, text: string): Promise<{ success: boolean; whatsappMessageId?: string; error?: string }> {
    const pageAccessToken = this.configService.get<string>('META_PAGE_ACCESS_TOKEN');
    const phoneNumberId = this.configService.get<string>('META_PHONE_NUMBER_ID') || '1320674383284386';
    const apiVersion = this.configService.get<string>('META_GRAPH_API_VERSION') || META_CONSTANTS.DEFAULT_GRAPH_API_VERSION;

    if (!pageAccessToken) {
      this.logger.error('META_PAGE_ACCESS_TOKEN is missing in environment variables');
      return { success: false, error: 'META_PAGE_ACCESS_TOKEN is not configured on server' };
    }

    // Format phone number (remove +, spaces, dashes, and ensure country code 91 for 10-digit numbers)
    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length === 10) {
      cleanPhone = `91${cleanPhone}`;
    } else if (cleanPhone.length === 11 && cleanPhone.startsWith('0')) {
      cleanPhone = `91${cleanPhone.slice(1)}`;
    }

    const url = `${META_CONSTANTS.GRAPH_API_BASE_URL}/${apiVersion}/${phoneNumberId}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'text',
      text: { body: text },
    };

    try {
      this.logger.log(`Sending WhatsApp message to ${cleanPhone} via Cloud API`);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${pageAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const responseData = await response.json().catch(() => ({}));

      if (!response.ok) {
        const errorMsg = responseData?.error?.message || `HTTP ${response.status} ${response.statusText}`;
        this.logger.error(`WhatsApp Cloud API Error for ${cleanPhone}: ${errorMsg}`);
        return { success: false, error: errorMsg };
      }

      const wamid = responseData?.messages?.[0]?.id || `wamid.simulated.${Date.now()}`;
      this.logger.log(`WhatsApp message delivered to ${cleanPhone}. Message ID: ${wamid}`);
      return { success: true, whatsappMessageId: wamid };
    } catch (err: any) {
      this.logger.error(`Failed to send WhatsApp message to ${cleanPhone}: ${err?.message || err}`);
      return { success: false, error: err?.message || 'Network request failed' };
    }
  }
}
