/** Backend field name → `t.integrations.field` key (unknown names fall back to the raw name). */
export const FIELD_LABEL_KEY = {
  api_key: 'apiKey',
  appid: 'appId',
  access_token: 'accessToken',
  access_key: 'accessKey',
  app_key: 'appKey',
  resource_id: 'resourceId',
  tts_resource_id: 'ttsResourceId',
  api_keys: 'apiKeys',
  access_keys: 'accessKeys',
} as const;

export type FieldLabelKey = (typeof FIELD_LABEL_KEY)[keyof typeof FIELD_LABEL_KEY];

export function isKnownFieldName(name: string): name is keyof typeof FIELD_LABEL_KEY {
  return Object.prototype.hasOwnProperty.call(FIELD_LABEL_KEY, name);
}
