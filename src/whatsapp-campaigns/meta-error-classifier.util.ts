export type MetaErrorCategory =
  | 'template_config'
  | 'recipient_delivery'
  | 'policy_restriction'
  | 'authentication'
  | 'billing_account_limit'
  | 'temporary_technical';

export interface ClassifiedMetaError {
  category: MetaErrorCategory;
  retryable: boolean;
  label: string;
  recommendation: string;
}

const ERROR_CATALOG: Record<string, ClassifiedMetaError> = {
  '132001': {
    category: 'template_config',
    retryable: false,
    label: 'Template Missing / Language Mismatch',
    recommendation:
      'Verify the exact template name and language code in Meta Manager, then click "Sync with Meta".',
  },
  '132000': {
    category: 'template_config',
    retryable: false,
    label: 'Template Parameter Count Mismatch',
    recommendation:
      'Ensure mapped variables and button parameters match the approved Meta template definition, then re-sync templates.',
  },
  '132018': {
    category: 'template_config',
    retryable: false,
    label: 'Invalid Template Parameter',
    recommendation:
      'Remove invalid newlines/tabs or empty parameter values and verify variable formatting.',
  },
  '100': {
    category: 'template_config',
    retryable: false,
    label: 'Invalid API Parameter',
    recommendation:
      'Check recipient phone format, cleaned parameter values, and template configuration.',
  },
  '131026': {
    category: 'recipient_delivery',
    retryable: false,
    label: 'Message Undeliverable',
    recommendation:
      'Recipient could not receive the message. Remove invalid or non-WhatsApp numbers from future marketing lists.',
  },
  '131049': {
    category: 'policy_restriction',
    retryable: false,
    label: 'Marketing Frequency Cap (#131049)',
    recommendation:
      'Meta suppressed delivery to preserve ecosystem quality. Do not retry immediately; respect cooldown before re-messaging.',
  },
  '190': {
    category: 'authentication',
    retryable: false,
    label: 'Invalid / Expired OAuth Token',
    recommendation:
      'Update the Meta System User permanent access token in WhatsApp Settings.',
  },
  '131042': {
    category: 'billing_account_limit',
    retryable: false,
    label: 'Payment / Billing Eligibility Issue',
    recommendation:
      'Check payment method and billing status in Meta Business Portfolio.',
  },
  '130429': {
    category: 'billing_account_limit',
    retryable: true,
    label: 'Rate Limit Reached',
    recommendation:
      'Throughput limit hit. Use a slightly higher delay between messages (10–30s).',
  },
  '131056': {
    category: 'billing_account_limit',
    retryable: true,
    label: 'Pair Rate Limit Hit',
    recommendation:
      'Too many messages sent to this phone number in a short window; retry after cooldown.',
  },
};

export function classifyMetaError(errorCode?: string | number, errorMessage?: string): ClassifiedMetaError {
  const codeStr = errorCode !== undefined && errorCode !== null ? String(errorCode).trim() : '';
  if (codeStr && ERROR_CATALOG[codeStr]) {
    return ERROR_CATALOG[codeStr];
  }

  const msg = String(errorMessage || '').toLowerCase();
  if (msg.includes('does not exist in the translation') || msg.includes('132001')) {
    return ERROR_CATALOG['132001'];
  }
  if (msg.includes('number of parameters') || msg.includes('132000')) {
    return ERROR_CATALOG['132000'];
  }
  if (msg.includes('131049') || msg.includes('healthy ecosystem') || msg.includes('frequency')) {
    return ERROR_CATALOG['131049'];
  }
  if (msg.includes('undeliverable') || msg.includes('131026')) {
    return ERROR_CATALOG['131026'];
  }
  if (msg.includes('oauth') || msg.includes('access token') || msg.includes('session has expired')) {
    return ERROR_CATALOG['190'];
  }
  if (msg.includes('payment') || msg.includes('billing')) {
    return ERROR_CATALOG['131042'];
  }

  return {
    category: 'temporary_technical',
    retryable: true,
    label: 'Transient / Network Error',
    recommendation: 'Temporary Meta API or network issue. Safe to retry after backoff.',
  };
}
