export interface MetaFieldData {
  name: string;
  values: string[];
}

export interface MetaLeadGraphResponse {
  id: string;
  created_time: string;
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  form_id?: string;
  form_name?: string;
  platform?: string;
  field_data?: MetaFieldData[];
  [key: string]: any;
}

export interface MetaLeadgenChangeValue {
  leadgen_id: string;
  page_id?: string;
  form_id?: string;
  ad_id?: string;
  adgroup_id?: string;
  adset_id?: string;
  campaign_id?: string;
  created_time?: number;
  [key: string]: any;
}

export interface MetaWebhookChange {
  field: string;
  value: MetaLeadgenChangeValue;
}

export interface MetaWebhookEntry {
  id: string;
  time: number;
  changes: MetaWebhookChange[];
}

export interface MetaWebhookPayload {
  object: string;
  entry: MetaWebhookEntry[];
}

export interface MappedMetaLeadData {
  metaLeadId: string;
  name: string;
  phone: string;
  email?: string;
  company?: string;
  city?: string;
  requirement?: string;
  platform?: string;
  campaignId?: string;
  campaignName?: string;
  adSetId?: string;
  adSetName?: string;
  adId?: string;
  adName?: string;
  formId?: string;
  formName?: string;
  metaRawData?: Record<string, any>;
}
