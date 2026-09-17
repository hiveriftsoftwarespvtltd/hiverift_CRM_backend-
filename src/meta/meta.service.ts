import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
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

  /**
   * Uploads an image binary buffer or base64 data to Meta Graph API Media endpoint
   * POST /{version}/{phone_number_id}/media
   */
  async uploadWhatsAppMedia(fileBuffer: Buffer, mimeType = 'image/jpeg', filename = 'image.jpeg'): Promise<string | null> {
    const pageAccessToken = this.configService.get<string>('META_PAGE_ACCESS_TOKEN');
    const phoneNumberId = this.configService.get<string>('META_PHONE_NUMBER_ID') || '1320674383284386';
    const apiVersion = this.configService.get<string>('META_GRAPH_API_VERSION') || META_CONSTANTS.DEFAULT_GRAPH_API_VERSION;

    if (!pageAccessToken) {
      this.logger.error('META_PAGE_ACCESS_TOKEN is missing when uploading media');
      return null;
    }

    const url = `${META_CONSTANTS.GRAPH_API_BASE_URL}/${apiVersion}/${phoneNumberId}/media`;

    try {
      const formData = new FormData();
      const blob = new Blob([new Uint8Array(fileBuffer)], { type: mimeType });
      formData.append('file', blob, filename);
      formData.append('type', mimeType);
      formData.append('messaging_product', 'whatsapp');

      this.logger.log(`Uploading media to Meta Graph API (${mimeType}, ${fileBuffer.length} bytes)`);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${pageAccessToken}`,
        },
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        this.logger.error(`Meta Media Upload failed: ${data?.error?.message || response.statusText}`);
        return null;
      }

      const mediaId = data.id;
      this.logger.log(`Meta Media Upload successful. Media ID: ${mediaId}`);
      try {
        const cacheDir = path.join(process.cwd(), 'uploads', 'whatsapp');
        if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(path.join(cacheDir, `${mediaId}.cache`), fileBuffer);
        fs.writeFileSync(path.join(cacheDir, `${mediaId}.json`), JSON.stringify({ mimeType, mediaId, cachedAt: new Date().toISOString() }));
      } catch (cacheErr: any) {
        this.logger.warn(`Could not write media cache for uploaded ${mediaId}: ${cacheErr?.message}`);
      }
      return mediaId;
    } catch (err: any) {
      this.logger.error(`Error uploading media to Meta: ${err?.message || err}`);
      return null;
    }
  }

  /**
   * Sends a WhatsApp image/media message to a customer via Meta WhatsApp Cloud API
   * Supports both public HTTP/HTTPS URLs and base64/buffer image uploads
   */
  async sendWhatsAppMediaMessage(
    phone: string,
    mediaUrl: string,
    caption?: string,
    mediaType = 'image',
    fileName?: string,
  ): Promise<{ success: boolean; whatsappMessageId?: string; mediaId?: string; error?: string }> {
    const pageAccessToken = this.configService.get<string>('META_PAGE_ACCESS_TOKEN');
    const phoneNumberId = this.configService.get<string>('META_PHONE_NUMBER_ID') || '1320674383284386';
    const apiVersion = this.configService.get<string>('META_GRAPH_API_VERSION') || META_CONSTANTS.DEFAULT_GRAPH_API_VERSION;

    if (!pageAccessToken) {
      this.logger.error('META_PAGE_ACCESS_TOKEN is missing in environment variables');
      return { success: false, error: 'META_PAGE_ACCESS_TOKEN is not configured on server' };
    }

    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length === 10) {
      cleanPhone = `91${cleanPhone}`;
    } else if (cleanPhone.length === 11 && cleanPhone.startsWith('0')) {
      cleanPhone = `91${cleanPhone.slice(1)}`;
    }

    let mediaPayload: any = {};
    let uploadedMediaId: string | null = null;
    const isDoc = mediaType === 'document' || mediaUrl.includes('application/pdf') || mediaUrl.endsWith('.pdf');
    const finalType = isDoc ? 'document' : (mediaType || 'image');

    // Check if mediaUrl is a Data URI (Base64) or local file
    if (mediaUrl.startsWith('data:')) {
      const commaIndex = mediaUrl.indexOf(',');
      if (commaIndex !== -1) {
        const header = mediaUrl.slice(0, commaIndex);
        const rawBase64 = mediaUrl.slice(commaIndex + 1).replace(/\s/g, '');
        const mimeMatch = header.match(/^data:([^;]+)/);
        const rawMime = mimeMatch ? mimeMatch[1] : '';
        const isPdfMime = isDoc || rawMime.includes('pdf') || (fileName && fileName.toLowerCase().endsWith('.pdf'));
        const mimeType = isPdfMime ? 'application/pdf' : (rawMime || 'image/jpeg');
        const buffer = Buffer.from(rawBase64, 'base64');
        const defaultExt = isPdfMime ? 'pdf' : (mimeType.split('/')[1] || 'jpeg');
        const actualFileName = fileName || `document.${defaultExt}`;

        uploadedMediaId = await this.uploadWhatsAppMedia(buffer, mimeType, actualFileName);

        if (!uploadedMediaId) {
          return { success: false, error: 'Failed to upload media file to Meta WhatsApp Cloud' };
        }

        if (finalType === 'document') {
          mediaPayload = {
            id: uploadedMediaId,
            filename: actualFileName,
            ...(caption ? { caption } : {}),
          };
        } else {
          mediaPayload = { id: uploadedMediaId, ...(caption ? { caption } : {}) };
        }
      } else {
        return { success: false, error: 'Invalid base64 media data format' };
      }
    } else {
      // HTTP/HTTPS Public Link
      if (finalType === 'document') {
        mediaPayload = {
          link: mediaUrl,
          filename: fileName || 'document.pdf',
          ...(caption ? { caption } : {}),
        };
      } else {
        mediaPayload = { link: mediaUrl, ...(caption ? { caption } : {}) };
      }
    }

    const url = `${META_CONSTANTS.GRAPH_API_BASE_URL}/${apiVersion}/${phoneNumberId}/messages`;

    const payload: any = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: finalType,
      [finalType]: mediaPayload,
    };

    try {
      this.logger.log(`Sending WhatsApp ${mediaType} message to ${cleanPhone} via Cloud API`);

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
        this.logger.error(`WhatsApp Cloud API Media Error for ${cleanPhone}: ${errorMsg}`);
        return { success: false, error: errorMsg };
      }

      const wamid = responseData?.messages?.[0]?.id || `wamid.simulated.${Date.now()}`;
      this.logger.log(`WhatsApp media message delivered to ${cleanPhone}. Message ID: ${wamid}`);
      return { success: true, whatsappMessageId: wamid, mediaId: uploadedMediaId || undefined };
    } catch (err: any) {
      this.logger.error(`Failed to send WhatsApp media message to ${cleanPhone}: ${err?.message || err}`);
      return { success: false, error: err?.message || 'Network request failed' };
    }
  }

  /**
   * Downloads media binary from Meta Graph API using media_id (with disk caching)
   */
  async getWhatsAppMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    if (!mediaId) return null;

    const cacheDir = path.join(process.cwd(), 'uploads', 'whatsapp');
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const cachedFilePath = path.join(cacheDir, `${mediaId}.cache`);
    const metaInfoPath = path.join(cacheDir, `${mediaId}.json`);

    // 1. Check local disk cache
    if (fs.existsSync(cachedFilePath) && fs.existsSync(metaInfoPath)) {
      try {
        const buffer = fs.readFileSync(cachedFilePath);
        const meta = JSON.parse(fs.readFileSync(metaInfoPath, 'utf8'));
        return { buffer, mimeType: meta.mimeType || 'image/jpeg' };
      } catch (cacheReadErr: any) {
        this.logger.warn(`Disk cache read failed for ${mediaId}, fetching fresh from Meta: ${cacheReadErr?.message}`);
      }
    }

    // 2. If mediaId is a WhatsApp message ID (wamid.), do NOT call Meta Graph API (which expects numeric mediaId)
    if (mediaId.startsWith('wamid.')) {
      try {
        const files = fs.readdirSync(cacheDir).filter((f) => f.endsWith('.cache'));
        if (files.length > 0) {
          let latestFile = files[0];
          let latestMtime = fs.statSync(path.join(cacheDir, latestFile)).mtimeMs;
          for (const f of files) {
            const mtime = fs.statSync(path.join(cacheDir, f)).mtimeMs;
            if (mtime > latestMtime) {
              latestMtime = mtime;
              latestFile = f;
            }
          }
          const buffer = fs.readFileSync(path.join(cacheDir, latestFile));
          const metaPath = path.join(cacheDir, `${latestFile.replace('.cache', '')}.json`);
          let mimeType = 'image/jpeg';
          if (fs.existsSync(metaPath)) {
            try {
              const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
              if (meta.mimeType) mimeType = meta.mimeType;
            } catch (e) {}
          }
          return { buffer, mimeType };
        }
      } catch (e) {}
      return null;
    }

    const pageAccessToken = this.configService.get<string>('META_PAGE_ACCESS_TOKEN');
    const apiVersion = this.configService.get<string>('META_GRAPH_API_VERSION') || META_CONSTANTS.DEFAULT_GRAPH_API_VERSION;

    if (!pageAccessToken) {
      this.logger.warn('META_PAGE_ACCESS_TOKEN is missing when fetching media');
      return null;
    }

    try {
      const headers = {
        'Authorization': `Bearer ${pageAccessToken}`,
        'User-Agent': 'curl/7.64.1',
      };

      // Step 1: Get media URL
      const infoUrl = `${META_CONSTANTS.GRAPH_API_BASE_URL}/${apiVersion}/${mediaId}`;
      const infoRes = await fetch(infoUrl, { headers });

      if (!infoRes.ok) {
        this.logger.warn(`Could not fetch media info from Meta Graph API for mediaId ${mediaId} (${infoRes.statusText})`);
        return null;
      }

      const infoData = await infoRes.json();
      const mediaDownloadUrl = infoData.url;
      const mimeType = infoData.mime_type || 'image/jpeg';

      if (!mediaDownloadUrl) {
        return null;
      }

      // Step 2: Download binary
      const binaryRes = await fetch(mediaDownloadUrl, { headers });

      if (!binaryRes.ok) {
        this.logger.error(`Failed to download binary for mediaId ${mediaId}`);
        return null;
      }

      const arrayBuffer = await binaryRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Save to disk cache
      try {
        fs.writeFileSync(cachedFilePath, buffer);
        fs.writeFileSync(metaInfoPath, JSON.stringify({ mimeType, mediaId, cachedAt: new Date().toISOString() }));
      } catch (cacheWriteErr: any) {
        this.logger.warn(`Disk cache write failed for ${mediaId}: ${cacheWriteErr?.message}`);
      }

      return {
        buffer,
        mimeType,
      };
    } catch (err: any) {
      this.logger.error(`Error in getWhatsAppMedia for ${mediaId}: ${err?.message}`);
      return null;
    }
  }
}
