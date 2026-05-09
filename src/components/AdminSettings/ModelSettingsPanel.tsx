'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import { http, ApiError, MissingAuthError, SessionExpiredError } from '@/lib/api/http-client';

// ── API response envelope types (loose-typed because the backend response
//    shapes vary across the model-settings endpoints) ──
interface KnownProvidersResponse {
  success: boolean;
  providers: Record<string, unknown>[];
}

interface SavedProvidersResponse {
  success: boolean;
  providers: SavedProvider[];
}

interface AssignmentsResponse {
  success: boolean;
  assignments: Assignment[];
}

interface ProviderMutationResponse {
  success: boolean;
  message?: string;
  detail?: string;
}

interface FetchModelsResponse {
  success: boolean;
  models: string[];
  message?: string;
}

interface ResolveConfigResponse {
  success: boolean;
  config?: {
    provider_name?: string | null;
    api_url?: string | null;
    model_name?: string | null;
    source?: 'database' | 'environment' | 'none';
  };
}

type FunctionType = 'chat' | 'fast' | 'video_cut' | 'vision' | 'coding';

type TabType = 'providers' | 'assignments' | 'advanced';

interface KnownProvider {
  id: string;
  name: string;
  default_api_url: string;
  region: string;
  api_format: string;          // "auto" | "openai" | "anthropic"
  default_models: string[];    // Pre-configured model list (empty = use /models API)
}

interface SavedProvider {
  id: string;
  name: string;
  provider_type: string;
  api_url: string;
  api_key_masked: string;
  api_key_set: boolean;
  api_format: string;          // "auto" | "openai" | "anthropic"
  created_at: string | null;
  updated_at: string | null;
}

interface ProviderWithModels extends SavedProvider {
  models: string[];
  modelsFetched: boolean;
}

interface Assignment {
  function_type: FunctionType;
  provider_id: string;
  provider_name: string;
  provider_type: string;
  model_name: string;
  temperature: number;
  max_tokens: number;
  updated_at: string | null;
}

interface ProviderFormState {
  id: string | null; // null = creating new
  name: string;
  provider_type: string;
  api_url: string;
  api_key: string;
  api_key_changed: boolean;
  api_format: string;            // "auto" | "openai" | "anthropic"
  urlManuallyEdited: boolean;    // Track whether user manually edited URL
  formatManuallyEdited: boolean; // Track whether user manually edited format
}

interface AssignmentFormState {
  provider_id: string | null;
  model_name: string;
  temperature: number;
  modelInputMode: 'select' | 'manual';
}

interface TestResult {
  success: boolean;
  message: string;
  latency_ms?: number;
  model_info?: {
    model: string;
    format_used: string;
  };
}

const FUNCTION_TYPES: FunctionType[] = ['chat', 'fast', 'video_cut', 'vision', 'coding'];

// Coding-type provider IDs (used for badge coloring and default_models display)
const CODING_PROVIDER_TYPES = ['kimi_coding', 'codex', 'claude_coding', 'glm_coding'];

interface ResolvedConfig {
  function_type: string;
  provider_name: string | null;
  api_url: string | null;
  model_name: string | null;
  source: 'database' | 'environment' | 'none';
}

/* ── Icons ── */
const EyeIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
);
const EyeOffIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
  </svg>
);
const PlusIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
);
const PencilIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
  </svg>
);
const TrashIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);
const CheckIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
);
const XIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);
const WifiIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.14 0M1.394 9.393c5.857-5.858 15.355-5.858 21.213 0" />
  </svg>
);

const ModelSettingsPanel: React.FC = () => {
  const { t } = useLocale();
  const { showSuccess, showError } = useNotification();

  // ── Tab State ──
  const [activeTab, setActiveTab] = useState<TabType>('providers');

  // ── Data State ──
  const [knownProviders, setKnownProviders] = useState<KnownProvider[]>([]);
  const [savedProviders, setSavedProviders] = useState<ProviderWithModels[]>([]);
  const [assignments, setAssignments] = useState<Record<FunctionType, Assignment | null>>({
    chat: null, fast: null, video_cut: null, vision: null, coding: null,
  });
  const [loading, setLoading] = useState(true);

  // ── Provider Form State ──
  const [providerForm, setProviderForm] = useState<ProviderFormState | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [savingProvider, setSavingProvider] = useState(false);
  const [fetchingModels, setFetchingModels] = useState<string | 'new' | null>(null);
  const [testingProvider, setTestingProvider] = useState<string | 'new' | null>(null);
  const [providerTestResult, setProviderTestResult] = useState<TestResult | null>(null);
  const [lastTestedProviderId, setLastTestedProviderId] = useState<string | 'new' | null>(null);

  // ── Assignment Form State ──
  const [assignmentForms, setAssignmentForms] = useState<Record<FunctionType, AssignmentFormState>>({
    chat: { provider_id: null, model_name: '', temperature: 0.7, modelInputMode: 'select' },
    fast: { provider_id: null, model_name: '', temperature: 0.7, modelInputMode: 'select' },
    video_cut: { provider_id: null, model_name: '', temperature: 0.7, modelInputMode: 'select' },
    vision: { provider_id: null, model_name: '', temperature: 0.7, modelInputMode: 'select' },
    coding: { provider_id: null, model_name: '', temperature: 1.0, modelInputMode: 'select' },
  });
  const [savingAssignment, setSavingAssignment] = useState<FunctionType | null>(null);

  // ── Unsaved provider models cache ──
  const [newProviderModels, setNewProviderModels] = useState<string[]>([]);

  // ── Expanded model lists ──
  const [expandedProviderModels, setExpandedProviderModels] = useState<string | null>(null);

  // ── Delete Confirmation ──
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // ── Effective Config (Advanced Tab) ──
  const [effectiveConfigs, setEffectiveConfigs] = useState<Record<FunctionType, ResolvedConfig | null>>({
    chat: null, fast: null, video_cut: null, vision: null, coding: null,
  });
  const [loadingEffectiveConfig, setLoadingEffectiveConfig] = useState(false);

  const functionTypeLabels: Record<FunctionType, string> = {
    chat: t.adminSettings.modelChat,
    fast: t.adminSettings.modelFast,
    video_cut: t.adminSettings.modelVideoCut,
    vision: t.adminSettings.modelVision,
    coding: t.adminSettings.modelCoding,
  };

  // ── Data Fetching ──
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [knownData, savedData, assignData] = await Promise.all([
        http.get<KnownProvidersResponse>('/api/model-settings/providers'),
        http.get<SavedProvidersResponse>('/api/model-settings/providers/saved'),
        http.get<AssignmentsResponse>('/api/model-settings/assignments'),
      ]);

      if (knownData.success) {
        setKnownProviders(knownData.providers.map((p: Record<string, unknown>) => ({
          ...p,
          api_format: (p.api_format as string) || 'auto',
          default_models: (p.default_models as string[]) || [],
        })) as KnownProvider[]);
      }

      const providersWithModels: ProviderWithModels[] = [];
      if (savedData.success) {
        for (const p of savedData.providers) {
          providersWithModels.push({
            ...p,
            api_format: p.api_format || 'auto',
            models: [],
            modelsFetched: false,
          });
        }
      }
      setSavedProviders(providersWithModels);

      if (assignData.success) {
        const assignMap: Record<FunctionType, Assignment | null> = {
          chat: null, fast: null, video_cut: null, vision: null, coding: null,
        };
        const formUpdates: Record<FunctionType, AssignmentFormState> = {
          chat: { provider_id: null, model_name: '', temperature: 0.7, modelInputMode: 'select' },
          fast: { provider_id: null, model_name: '', temperature: 0.7, modelInputMode: 'select' },
          video_cut: { provider_id: null, model_name: '', temperature: 0.7, modelInputMode: 'select' },
          vision: { provider_id: null, model_name: '', temperature: 0.7, modelInputMode: 'select' },
          coding: { provider_id: null, model_name: '', temperature: 1.0, modelInputMode: 'select' },
        };
        for (const a of assignData.assignments) {
          const ft = a.function_type as FunctionType;
          if (ft in assignMap) {
            assignMap[ft] = a;
            formUpdates[ft] = {
              provider_id: a.provider_id,
              model_name: a.model_name,
              temperature: a.temperature,
              modelInputMode: 'select',
            };
          }
        }
        setAssignments(assignMap);
        setAssignmentForms(formUpdates);
      }
    } catch (err) {
      if (err instanceof MissingAuthError) {
        showError(t.adminSettings.authRequiredError);
      } else if (err instanceof SessionExpiredError) {
        showError(t.adminSettings.sessionExpiredError);
      } else {
        showError(t.adminSettings.modelSaveError);
      }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch effective configs when advanced tab is first activated
  useEffect(() => {
    if (activeTab === 'advanced' && !effectiveConfigs.chat && !loadingEffectiveConfig) {
      fetchEffectiveConfigs();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // ── Helpers ──
  const isCodingProvider = (providerType: string): boolean => {
    return CODING_PROVIDER_TYPES.includes(providerType);
  };

  const getKnownProviderForType = (providerType: string): KnownProvider | undefined => {
    return knownProviders.find(p => p.id === providerType);
  };

  const getDefaultModelsForForm = (): string[] => {
    if (!providerForm) return [];
    const known = getKnownProviderForType(providerForm.provider_type);
    return known?.default_models || [];
  };

  const getApiFormatLabel = (format: string): string => {
    switch (format) {
      case 'openai': return t.adminSettings.apiFormatOpenai;
      case 'anthropic': return t.adminSettings.apiFormatAnthropic;
      default: return t.adminSettings.apiFormatAuto;
    }
  };

  // ── Provider CRUD ──
  const openProviderForm = (provider?: SavedProvider) => {
    if (provider) {
      setProviderForm({
        id: provider.id,
        name: provider.name,
        provider_type: provider.provider_type,
        api_url: provider.api_url,
        api_key: '',
        api_key_changed: false,
        api_format: provider.api_format || 'auto',
        urlManuallyEdited: true,    // Existing provider: treat URL as manually set
        formatManuallyEdited: true, // Existing provider: treat format as manually set
      });
    } else {
      setProviderForm({
        id: null,
        name: '',
        provider_type: '',
        api_url: '',
        api_key: '',
        api_key_changed: true,
        api_format: 'auto',
        urlManuallyEdited: false,
        formatManuallyEdited: false,
      });
    }
    setShowApiKey(false);
    setProviderTestResult(null);
    setNewProviderModels([]);
  };

  const handleProviderTypeSelect = (providerTypeId: string) => {
    const known = knownProviders.find(p => p.id === providerTypeId);
    if (known) {
      setProviderForm(prev => {
        if (!prev) return null;
        return {
          ...prev,
          provider_type: known.id,
          // Auto-fill URL only if user hasn't manually edited it
          api_url: prev.urlManuallyEdited ? prev.api_url : known.default_api_url,
          // Auto-fill format only if user hasn't manually edited it
          api_format: prev.formatManuallyEdited ? prev.api_format : known.api_format,
          name: prev.name || known.name,
        };
      });
    } else {
      setProviderForm(prev => prev ? { ...prev, provider_type: providerTypeId } : null);
    }
  };

  const handleSaveProvider = async () => {
    if (!providerForm || !providerForm.name || !providerForm.api_url) return;

    setSavingProvider(true);
    try {
      let data: ProviderMutationResponse;
      if (providerForm.id) {
        // Update
        data = await http.put<ProviderMutationResponse>(
          `/api/model-settings/providers/${providerForm.id}`,
          {
            name: providerForm.name,
            provider_type: providerForm.provider_type,
            api_url: providerForm.api_url,
            api_key: ***REMOVED*** ? providerForm.api_key : '__KEEP__',
            api_format: providerForm.api_format,
          },
        );
      } else {
        // Create
        if (!providerForm.api_key) {
          showError(t.adminSettings.modelApiKeyRequired);
          return; // finally{} will reset savingProvider
        }
        data = await http.post<ProviderMutationResponse>('/api/model-settings/providers', {
          name: providerForm.name,
          provider_type: providerForm.provider_type || 'custom',
          api_url: providerForm.api_url,
          api_key: providerForm.api_key,
          api_format: providerForm.api_format,
        });
      }
      if (data.success) {
        showSuccess(t.adminSettings.modelProviderSaved);
        setProviderForm(null);
        await fetchData();
      } else {
        showError(data.detail || data.message || t.adminSettings.modelProviderCreateError);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        showError(err.message || t.adminSettings.modelProviderCreateError);
      } else {
        showError(t.adminSettings.modelProviderCreateError);
      }
    } finally {
      setSavingProvider(false);
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    try {
      const data = await http.del<ProviderMutationResponse>(
        `/api/model-settings/providers/${providerId}`,
      );
      if (data.success) {
        showSuccess(t.adminSettings.modelProviderDeleted);
        setDeleteConfirmId(null);
        await fetchData();
      } else {
        showError(data.detail || t.adminSettings.modelDeleteProviderError);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        showError(err.message || t.adminSettings.modelDeleteProviderError);
      } else {
        showError(t.adminSettings.modelDeleteProviderError);
      }
    }
  };

  const handleFetchModelsForProvider = async (providerId: string | 'new') => {
    setFetchingModels(providerId);
    try {
      let data: FetchModelsResponse;
      if (providerId === 'new' && providerForm) {
        // Fetch for unsaved provider using ad-hoc credentials
        data = await http.post<FetchModelsResponse>('/api/model-settings/fetch-models', {
          api_url: providerForm.api_url,
          api_key: providerForm.api_key,
        });
      } else {
        data = await http.post<FetchModelsResponse>(
          `/api/model-settings/providers/${providerId}/fetch-models`,
        );
      }
      if (data.success && data.models.length > 0) {
        if (providerId === 'new') {
          setNewProviderModels(data.models);
          showSuccess(`${data.models.length} ${t.adminSettings.modelModelsFound}`);
        } else {
          setSavedProviders(prev => prev.map(p =>
            p.id === providerId ? { ...p, models: data.models, modelsFetched: true } : p
          ));
        }
      } else {
        showError(data.message || t.adminSettings.modelFetchModelsError);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        showError(err.message || t.adminSettings.modelFetchModelsError);
      } else {
        showError(t.adminSettings.modelFetchModelsError);
      }
    } finally {
      setFetchingModels(null);
    }
  };

  const handleTestProviderConnection = async (providerId: string | 'new', modelName?: string) => {
    setTestingProvider(providerId);
    setProviderTestResult(null);
    setLastTestedProviderId(providerId);

    let api_url = '';
    let api_key = '';
    let api_format: string | undefined;
    let provider_type: string | undefined;

    if (providerId === 'new' && providerForm) {
      api_url = providerForm.api_url;
      api_key = providerForm.api_key;
      api_format = providerForm.api_format !== 'auto' ? providerForm.api_format : undefined;
      provider_type = providerForm.provider_type || undefined;
      // Use default_models[0] if no model specified
      if (!modelName) {
        const defaultModels = getDefaultModelsForForm();
        const formModels = newProviderModels;
        modelName = defaultModels[0] || formModels[0] || 'test';
      }
    } else {
      const provider = savedProviders.find(p => p.id === providerId);
      if (!provider) return;
      api_url = provider.api_url;
      api_format = provider.api_format !== 'auto' ? provider.api_format : undefined;
      provider_type = provider.provider_type || undefined;
      // Use first fetched model or default model for the type
      if (!modelName) {
        if (provider.models.length > 0) {
          modelName = provider.models[0];
        } else {
          const known = getKnownProviderForType(provider.provider_type);
          modelName = known?.default_models?.[0] || 'test';
        }
      }
    }

    try {
      const data = await http.post<TestResult>('/api/model-settings/test-connection', {
        api_url,
        api_key,
        model_name: modelName || 'test',
        provider_id: providerId === 'new' ? undefined : providerId,
        provider_type,
        api_format,
      });
      setProviderTestResult(data);
    } catch (err) {
      if (err instanceof ApiError) {
        setProviderTestResult({ success: false, message: err.message || t.adminSettings.modelRequestFailed });
      } else {
        setProviderTestResult({ success: false, message: t.adminSettings.modelRequestFailed });
      }
    } finally {
      setTestingProvider(null);
    }
  };

  // ── Assignment CRUD ──
  const updateAssignmentForm = (ft: FunctionType, updates: Partial<AssignmentFormState>) => {
    setAssignmentForms(prev => ({
      ...prev,
      [ft]: { ...prev[ft], ...updates },
    }));
  };

  const handleAssignmentProviderChange = async (ft: FunctionType, providerId: string) => {
    updateAssignmentForm(ft, { provider_id: providerId, model_name: '', modelInputMode: 'select' });
    // Auto-fetch models for this provider if not yet fetched
    const provider = savedProviders.find(p => p.id === providerId);
    if (provider && !provider.modelsFetched) {
      // Check if knownProviders has default_models for this provider type — skip fetch if so
      const known = knownProviders.find(k => k.id === provider.provider_type);
      if (known?.default_models && known.default_models.length > 0) {
        // Mark as fetched with default_models so we don't re-fetch
        setSavedProviders(prev => prev.map(p =>
          p.id === providerId ? { ...p, models: known.default_models, modelsFetched: true } : p
        ));
      } else {
        await handleFetchModelsForProvider(providerId);
      }
    }
  };

  const handleSaveAssignment = async (ft: FunctionType) => {
    const form = assignmentForms[ft];
    if (!form.provider_id || !form.model_name) return;

    setSavingAssignment(ft);
    try {
      const data = await http.put<ProviderMutationResponse>(
        '/api/model-settings/assignments',
        {
          function_type: ft,
          provider_id: form.provider_id,
          model_name: form.model_name,
          temperature: form.temperature,
          max_tokens: 128000,
        },
      );
      if (data.success) {
        showSuccess(t.adminSettings.modelAssignmentSaved);
        await fetchData();
      } else {
        showError(data.detail || t.adminSettings.modelSaveError);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        showError(err.message || t.adminSettings.modelSaveError);
      } else {
        showError(t.adminSettings.modelSaveError);
      }
    } finally {
      setSavingAssignment(null);
    }
  };

  const handleResetAssignment = async (ft: FunctionType) => {
    try {
      await http.del(`/api/model-settings/assignments/${ft}`);
      showSuccess(t.adminSettings.modelAssignmentDeleted);
      const defaultTemp = ft === 'coding' ? 1.0 : 0.7;
      updateAssignmentForm(ft, { provider_id: null, model_name: '', temperature: defaultTemp, modelInputMode: 'select' });
      setAssignments(prev => ({ ...prev, [ft]: null }));
    } catch (err) {
      if (err instanceof ApiError) {
        showError(err.message || t.adminSettings.modelSaveError);
      } else {
        showError(t.adminSettings.modelSaveError);
      }
    }
  };

  // ── Helpers ──
  const getProviderModels = (providerId: string | null): string[] => {
    if (!providerId) return [];
    const provider = savedProviders.find(p => p.id === providerId);
    if (!provider) return [];
    // 1. Use fetched models if available
    if (provider.models && provider.models.length > 0) return provider.models;
    // 2. Fall back to default_models from knownProviders for this provider_type
    const known = knownProviders.find(k => k.id === provider.provider_type);
    if (known?.default_models && known.default_models.length > 0) return known.default_models;
    return [];
  };

  const getAssignmentsForProvider = (providerId: string): FunctionType[] => {
    return FUNCTION_TYPES.filter(ft => assignments[ft]?.provider_id === providerId);
  };

  const getProviderTypeBadge = (providerType: string) => {
    const known = knownProviders.find(p => p.id === providerType);
    return known?.name || providerType || 'Custom';
  };

  const truncateUrl = (url: string, maxLen = 45): string => {
    if (url.length <= maxLen) return url;
    return url.substring(0, maxLen) + '...';
  };

  const fetchEffectiveConfigs = useCallback(async () => {
    setLoadingEffectiveConfig(true);
    try {
      const results = await Promise.all(
        FUNCTION_TYPES.map(async (ft) => {
          try {
            const data = await http.get<ResolveConfigResponse>(`/api/model-settings/resolve/${ft}`);
            if (data.success && data.config) {
              return {
                ft,
                config: {
                  function_type: ft,
                  provider_name: data.config.provider_name || null,
                  api_url: data.config.api_url || null,
                  model_name: data.config.model_name || null,
                  source: data.config.source || (data.config.provider_name ? 'database' : 'environment'),
                } as ResolvedConfig,
              };
            }
            return { ft, config: { function_type: ft, provider_name: null, api_url: data.config?.api_url || null, model_name: data.config?.model_name || null, source: 'environment' as const } };
          } catch {
            // Optional advanced-tab feature; per-function failure is non-fatal.
            return { ft, config: { function_type: ft, provider_name: null, api_url: null, model_name: null, source: 'none' as const } };
          }
        })
      );
      const configMap: Record<FunctionType, ResolvedConfig | null> = {
        chat: null, fast: null, video_cut: null, vision: null, coding: null,
      };
      for (const r of results) {
        configMap[r.ft as FunctionType] = r.config;
      }
      setEffectiveConfigs(configMap);
    } finally {
      setLoadingEffectiveConfig(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const domesticKnown = knownProviders.filter(p => p.region === 'domestic');
  const internationalKnown = knownProviders.filter(p => p.region === 'international');

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <div className="text-muted-foreground">{t.adminSettings.loading}</div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════
  // Tab 1: Provider Management Content
  // ═══════════════════════════════════════════════════════
  const renderProvidersTab = () => (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xl font-semibold text-foreground">
          {t.adminSettings.modelProviders}
        </h2>
        <button
          onClick={() => openProviderForm()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
        >
          <PlusIcon />
          {t.adminSettings.modelAddProvider}
        </button>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        {t.adminSettings.modelProvidersDesc}
      </p>

      {/* Provider Cards */}
      <div className="space-y-3">
        {savedProviders.map(provider => {
          const isCoding = isCodingProvider(provider.provider_type);
          return (
            <div
              key={provider.id}
              className="p-4 rounded-lg border border-border bg-card"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-foreground text-sm">{provider.name}</span>
                      <span className={`px-1.5 py-0.5 text-xs rounded ${
                        isCoding
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        {getProviderTypeBadge(provider.provider_type)}
                      </span>
                      <span className="px-1.5 py-0.5 text-xs rounded bg-muted text-muted-foreground">
                        {getApiFormatLabel(provider.api_format)}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {truncateUrl(provider.api_url)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Key: {provider.api_key_set
                        ? <span className="text-green-600 dark:text-green-400">{provider.api_key_masked}</span>
                        : <span className="text-amber-600 dark:text-amber-400">{t.adminSettings.modelKeyNotSet}</span>
                      }
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                  <button
                    onClick={() => handleTestProviderConnection(provider.id)}
                    disabled={testingProvider === provider.id}
                    className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                    title={t.adminSettings.modelTestConnection}
                  >
                    <WifiIcon />
                  </button>
                  <button
                    onClick={() => openProviderForm(provider)}
                    className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                    title={t.adminSettings.modelEditProvider}
                  >
                    <PencilIcon />
                  </button>
                  {deleteConfirmId === provider.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleDeleteProvider(provider.id)}
                        className="p-1.5 text-destructive hover:text-destructive/80 transition-colors"
                        title={t.adminSettings.confirmDelete}
                      >
                        <CheckIcon />
                      </button>
                      <button
                        onClick={() => setDeleteConfirmId(null)}
                        className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                        title={t.adminSettings.cancelDelete}
                      >
                        <XIcon />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirmId(provider.id)}
                      className="p-1.5 text-muted-foreground hover:text-destructive transition-colors"
                      title={t.adminSettings.modelDeleteProvider}
                    >
                      <TrashIcon />
                    </button>
                  )}
                </div>
              </div>

              {/* Test result shown inline on card */}
              {providerTestResult && testingProvider === null && lastTestedProviderId === provider.id && (
                <div className={`mt-2 text-sm rounded-md p-2.5 ${providerTestResult.success ? 'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300' : 'bg-red-50 dark:bg-red-950/30 text-destructive'}`}>
                  <div className="flex items-center gap-1.5">
                    {providerTestResult.success ? <CheckIcon /> : <XIcon />}
                    {providerTestResult.success
                      ? `${t.adminSettings.modelTestSuccess} (${providerTestResult.latency_ms}ms)`
                      : `${t.adminSettings.modelTestFailed}: ${providerTestResult.message}`
                    }
                  </div>
                  {providerTestResult.success && providerTestResult.model_info && (
                    <div className="mt-1.5 text-xs space-y-0.5 pl-5">
                      <div>
                        <span className="text-muted-foreground">{t.adminSettings.modelInfo}:</span>{' '}
                        {providerTestResult.model_info.model}
                      </div>
                      <div>
                        <span className="text-muted-foreground">{t.adminSettings.formatUsed}:</span>{' '}
                        {providerTestResult.model_info.format_used}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Delete warning when provider is in use */}
              {deleteConfirmId === provider.id && (() => {
                const affected = getAssignmentsForProvider(provider.id);
                return affected.length > 0 ? (
                  <div className="mt-2 px-2 py-1.5 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded">
                    {t.adminSettings.modelDeleteProviderConfirm}
                    {' '}({affected.map(ft => functionTypeLabels[ft]).join(', ')})
                  </div>
                ) : null;
              })()}

              {/* Known default models for coding providers displayed as tags */}
              {isCoding && (() => {
                const known = getKnownProviderForType(provider.provider_type);
                const defaultModels = known?.default_models || [];
                return defaultModels.length > 0 ? (
                  <div className="mt-2">
                    <span className="text-xs text-muted-foreground mr-1.5">{t.adminSettings.defaultModels}:</span>
                    <div className="inline-flex flex-wrap gap-1 mt-0.5">
                      {defaultModels.map(model => (
                        <span
                          key={model}
                          className="px-2 py-0.5 text-xs rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
                        >
                          {model}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null;
              })()}

              {/* Fetched models list */}
              {provider.modelsFetched && provider.models.length > 0 && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => setExpandedProviderModels(
                      expandedProviderModels === provider.id ? null : provider.id
                    )}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                  >
                    <svg
                      className={`w-3 h-3 transition-transform ${expandedProviderModels === provider.id ? 'rotate-90' : ''}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    {provider.models.length} {t.adminSettings.modelModelsFound}
                  </button>
                  {expandedProviderModels === provider.id && (
                    <div className="mt-1.5 max-h-48 overflow-y-auto rounded border border-border bg-background">
                      {provider.models.map(model => (
                        <div
                          key={model}
                          className="px-2.5 py-1.5 text-xs text-foreground border-b border-border last:border-b-0 hover:bg-accent/50"
                        >
                          {model}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {savedProviders.length === 0 && !providerForm && (
          <div className="p-6 text-center text-sm text-muted-foreground border border-dashed border-border rounded-lg">
            {t.adminSettings.modelNoProviders}
          </div>
        )}
      </div>

      {/* Provider Add/Edit Form */}
      {providerForm && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (savingProvider || !providerForm.name || !providerForm.api_url) return;
            handleSaveProvider();
          }}
          className="mt-4 p-4 rounded-lg border border-primary/30 bg-card space-y-4"
        >
          <h3 className="text-sm font-medium text-foreground">
            {providerForm.id ? t.adminSettings.modelEditProvider : t.adminSettings.modelAddProvider}
          </h3>

          {/* Provider Name */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              {t.adminSettings.modelProviderName}
            </label>
            <input
              type="text"
              value={providerForm.name}
              onChange={e => setProviderForm(prev => prev ? { ...prev, name: e.target.value } : null)}
              placeholder={t.adminSettings.modelProviderNamePlaceholder}
              className="block w-full px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm focus:ring-2 focus:ring-ring focus:border-ring"
            />
          </div>

          {/* Provider Type */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              {t.adminSettings.modelProviderType}
            </label>
            <select
              value={providerForm.provider_type}
              onChange={e => handleProviderTypeSelect(e.target.value)}
              className="block w-full px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm focus:ring-2 focus:ring-ring focus:border-ring"
            >
              <option value="">{t.adminSettings.modelSelectProvider}</option>
              {domesticKnown.length > 0 && (
                <optgroup label={t.adminSettings.modelDomestic}>
                  {domesticKnown.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </optgroup>
              )}
              {internationalKnown.length > 0 && (
                <optgroup label={t.adminSettings.modelInternational}>
                  {internationalKnown.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </optgroup>
              )}
              <option value="custom">Custom</option>
            </select>
          </div>

          {/* API URL */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              {t.adminSettings.modelApiUrl}
            </label>
            <input
              type="text"
              value={providerForm.api_url}
              onChange={e => setProviderForm(prev => prev ? {
                ...prev,
                api_url: e.target.value,
                urlManuallyEdited: true,
              } : null)}
              placeholder={t.adminSettings.modelApiUrlPlaceholder}
              className="block w-full px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm focus:ring-2 focus:ring-ring focus:border-ring"
            />
          </div>

          {/* API Key */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              {t.adminSettings.modelApiKey}
            </label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                autoComplete="new-password"
                value={***REMOVED*** ? providerForm.api_key : ''}
                onChange={e => setProviderForm(prev => prev ? { ...prev, api_key: e.target.value, api_key_changed: true } : null)}
                onFocus={() => {
                  if (!***REMOVED*** && providerForm.id) {
                    setProviderForm(prev => prev ? { ...prev, api_key: '', api_key_changed: true } : null);
                  }
                }}
                placeholder={providerForm.id ? '••••••••' : t.adminSettings.modelApiKeyPlaceholder}
                className="block w-full px-3 py-2 pr-10 border border-border rounded-md bg-background text-foreground text-sm focus:ring-2 focus:ring-ring focus:border-ring"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
              >
                {showApiKey ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
          </div>

          {/* API Format */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              {t.adminSettings.apiFormat}
            </label>
            <select
              value={providerForm.api_format}
              onChange={e => setProviderForm(prev => prev ? {
                ...prev,
                api_format: e.target.value,
                formatManuallyEdited: true,
              } : null)}
              className="block w-full px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm focus:ring-2 focus:ring-ring focus:border-ring"
            >
              <option value="auto">{t.adminSettings.apiFormatAuto}</option>
              <option value="openai">{t.adminSettings.apiFormatOpenai}</option>
              <option value="anthropic">{t.adminSettings.apiFormatAnthropic}</option>
            </select>
          </div>

          {/* Default Models tags for coding-type providers */}
          {isCodingProvider(providerForm.provider_type) && (() => {
            const defaultModels = getDefaultModelsForForm();
            return defaultModels.length > 0 ? (
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  {t.adminSettings.defaultModels}
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {defaultModels.map(model => (
                    <span
                      key={model}
                      className="px-2.5 py-1 text-xs rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
                    >
                      {model}
                    </span>
                  ))}
                </div>
              </div>
            ) : null;
          })()}

          {/* Fetched models list (for non-coding providers) */}
          {!isCodingProvider(providerForm.provider_type) && (() => {
            const models = providerForm.id
              ? (savedProviders.find(p => p.id === providerForm.id)?.models || [])
              : newProviderModels;
            return models.length > 0 ? (
              <div>
                <button
                  type="button"
                  onClick={() => setExpandedProviderModels(
                    expandedProviderModels === (providerForm.id || 'new') ? null : (providerForm.id || 'new')
                  )}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                >
                  <svg
                    className={`w-3 h-3 transition-transform ${expandedProviderModels === (providerForm.id || 'new') ? 'rotate-90' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  {models.length} {t.adminSettings.modelModelsFound}
                </button>
                {expandedProviderModels === (providerForm.id || 'new') && (
                  <div className="mt-1.5 max-h-48 overflow-y-auto rounded border border-border bg-background">
                    {models.map(model => (
                      <div
                        key={model}
                        className="px-2.5 py-1.5 text-xs text-foreground border-b border-border last:border-b-0 hover:bg-accent/50"
                      >
                        {model}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null;
          })()}

          {/* Test Connection result */}
          {providerTestResult && (
            <div className={`text-sm rounded-md p-2.5 ${providerTestResult.success ? 'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300' : 'bg-red-50 dark:bg-red-950/30 text-destructive'}`}>
              <div className="flex items-center gap-1.5">
                {providerTestResult.success ? <CheckIcon /> : <XIcon />}
                {providerTestResult.success
                  ? `${t.adminSettings.modelTestSuccess} (${providerTestResult.latency_ms}ms)`
                  : `${t.adminSettings.modelTestFailed}: ${providerTestResult.message}`
                }
              </div>
              {providerTestResult.success && providerTestResult.model_info && (
                <div className="mt-1.5 text-xs space-y-0.5 pl-5">
                  <div>
                    <span className="text-muted-foreground">{t.adminSettings.modelInfo}:</span>{' '}
                    {providerTestResult.model_info.model}
                  </div>
                  <div>
                    <span className="text-muted-foreground">{t.adminSettings.formatUsed}:</span>{' '}
                    {providerTestResult.model_info.format_used}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Form Actions */}
          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleTestProviderConnection(providerForm.id || 'new')}
                disabled={testingProvider !== null || !providerForm.api_url || (!providerForm.api_key && !providerForm.id)}
                className="px-3 py-1.5 text-sm font-medium border border-border rounded-md text-foreground hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {testingProvider ? t.adminSettings.modelTesting : t.adminSettings.modelTestConnection}
              </button>
              {!isCodingProvider(providerForm.provider_type) && providerForm.api_key && providerForm.api_url && (
                <button
                  type="button"
                  onClick={() => handleFetchModelsForProvider(providerForm.id || 'new')}
                  disabled={fetchingModels !== null}
                  className="px-3 py-1.5 text-sm font-medium border border-border rounded-md text-foreground hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {fetchingModels ? t.adminSettings.modelFetchingModels : t.adminSettings.modelFetchModels}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setProviderForm(null); setProviderTestResult(null); }}
                className="px-3 py-1.5 text-sm font-medium border border-border rounded-md text-foreground hover:bg-accent transition-colors"
              >
                {t.adminSettings.cancel}
              </button>
              <button
                type="submit"
                disabled={savingProvider || !providerForm.name || !providerForm.api_url}
                className="px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {savingProvider ? t.adminSettings.modelSaving : t.adminSettings.modelSave}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );

  // ═══════════════════════════════════════════════════════
  // Tab 2: Model Assignment Content
  // ═══════════════════════════════════════════════════════
  const functionTypeIcons: Record<FunctionType, React.ReactNode> = {
    chat: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ),
    fast: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
    video_cut: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    ),
    vision: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </svg>
    ),
    coding: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
      </svg>
    ),
  };

  const renderAssignmentsTab = () => (
    <div>
      <div className="mb-2">
        <h2 className="text-xl font-semibold text-foreground">
          {t.adminSettings.modelAssignments}
        </h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        {t.adminSettings.modelAssignmentsDesc}
      </p>

      {savedProviders.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground border border-dashed border-border rounded-lg">
          {t.adminSettings.modelNoProviders}
        </div>
      ) : (
        <div className="space-y-4">
          {FUNCTION_TYPES.map(ft => {
            const form = assignmentForms[ft];
            const saved = assignments[ft];
            const models = getProviderModels(form.provider_id);

            return (
              <div key={ft} className="p-4 rounded-lg border border-border bg-card">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`flex items-center justify-center w-6 h-6 rounded ${
                      ft === 'coding'
                        ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400'
                        : 'bg-muted text-muted-foreground'
                    }`}>
                      {functionTypeIcons[ft]}
                    </span>
                    <h3 className="text-sm font-medium text-foreground">{functionTypeLabels[ft]}</h3>
                    <span className="text-xs text-muted-foreground font-mono">({ft})</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${saved ? 'bg-green-500' : 'bg-muted-foreground/50'}`} />
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      saved
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                        : 'bg-muted text-muted-foreground'
                    }`}>
                      {saved ? t.adminSettings.configFromDb : t.adminSettings.configFromEnv}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Provider Select */}
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">
                      {t.adminSettings.modelProvider}
                    </label>
                    <select
                      value={form.provider_id || ''}
                      onChange={e => {
                        const id = e.target.value;
                        if (id) {
                          handleAssignmentProviderChange(ft, id);
                        } else {
                          updateAssignmentForm(ft, { provider_id: null, model_name: '' });
                        }
                      }}
                      className="block w-full px-2 py-1.5 border border-border rounded-md bg-background text-foreground text-sm focus:ring-2 focus:ring-ring focus:border-ring"
                    >
                      <option value="">{t.adminSettings.modelSelectProvider}</option>
                      {savedProviders.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Model Select */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs text-muted-foreground">
                        {t.adminSettings.modelName}
                      </label>
                      <button
                        type="button"
                        onClick={() => updateAssignmentForm(ft, {
                          modelInputMode: form.modelInputMode === 'select' ? 'manual' : 'select',
                        })}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {form.modelInputMode === 'select'
                          ? t.adminSettings.modelOrInputManually
                          : t.adminSettings.modelSelectModel
                        }
                      </button>
                    </div>
                    {form.modelInputMode === 'select' && models.length > 0 ? (
                      <select
                        value={form.model_name}
                        onChange={e => updateAssignmentForm(ft, { model_name: e.target.value })}
                        className="block w-full px-2 py-1.5 border border-border rounded-md bg-background text-foreground text-sm focus:ring-2 focus:ring-ring focus:border-ring"
                      >
                        <option value="">{t.adminSettings.modelSelectModel}</option>
                        {models.map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={form.model_name}
                        onChange={e => updateAssignmentForm(ft, { model_name: e.target.value })}
                        placeholder={t.adminSettings.modelNamePlaceholder}
                        className="block w-full px-2 py-1.5 border border-border rounded-md bg-background text-foreground text-sm focus:ring-2 focus:ring-ring focus:border-ring"
                      />
                    )}
                  </div>
                </div>

                {/* Temperature + Actions */}
                <div className="mt-3 flex items-center gap-4">
                  <div className="flex items-center gap-2 flex-1">
                    <label className="text-xs text-muted-foreground whitespace-nowrap">
                      {t.adminSettings.modelTemperature}
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="0.1"
                      value={form.temperature}
                      onChange={e => updateAssignmentForm(ft, { temperature: parseFloat(e.target.value) })}
                      className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer bg-muted accent-primary"
                    />
                    <span className="text-xs text-muted-foreground font-mono w-6 text-right">
                      {form.temperature.toFixed(1)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {saved && (
                      <button
                        onClick={() => handleResetAssignment(ft)}
                        className="px-2 py-1 text-xs font-medium border border-border rounded text-foreground hover:bg-accent transition-colors"
                      >
                        {t.adminSettings.modelResetToDefault}
                      </button>
                    )}
                    <button
                      onClick={() => handleSaveAssignment(ft)}
                      disabled={savingAssignment === ft || !form.provider_id || !form.model_name}
                      className="px-2 py-1 text-xs font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {savingAssignment === ft ? t.adminSettings.modelSaving : t.adminSettings.modelSave}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // ═══════════════════════════════════════════════════════
  // Tab 3: Advanced Settings Content
  // ═══════════════════════════════════════════════════════

  // Static env var fallback mapping
  const envVarMapping: { ft: FunctionType; prefix: string; urlKey: string; apiKeyKey: string; modelKey: string; descKey: keyof typeof t.adminSettings }[] = [
    { ft: 'chat', prefix: 'LLM_*', urlKey: 'LLM_API_URL', apiKeyKey: 'LLM_API_KEY', modelKey: 'LLM_MODEL', descKey: 'envVarChatDesc' },
    { ft: 'fast', prefix: 'FAST_LLM_*', urlKey: 'FAST_LLM_API_URL', apiKeyKey: 'FAST_LLM_API_KEY', modelKey: 'FAST_LLM_MODEL', descKey: 'envVarFastDesc' },
    { ft: 'video_cut', prefix: 'VIDEO_CUT_LLM_*', urlKey: 'VIDEO_CUT_LLM_API_URL', apiKeyKey: 'VIDEO_CUT_LLM_API_KEY', modelKey: 'VIDEO_CUT_LLM_MODEL', descKey: 'envVarVideoCutDesc' },
    { ft: 'vision', prefix: 'VL_LLM_*', urlKey: 'VL_LLM_API_URL', apiKeyKey: 'VL_LLM_API_KEY', modelKey: 'VL_LLM_MODEL', descKey: 'envVarVisionDesc' },
    { ft: 'coding', prefix: 'CODING_LLM_*', urlKey: 'CODING_LLM_API_URL', apiKeyKey: 'CODING_LLM_API_KEY', modelKey: 'CODING_LLM_MODEL', descKey: 'envVarCodingDesc' },
  ];

  const renderAdvancedTab = () => (
    <div>
      <div className="mb-2">
        <h2 className="text-xl font-semibold text-foreground">
          {t.adminSettings.tabAdvanced}
        </h2>
      </div>

      {/* Section 1: Environment Variable Fallback Reference Table */}
      <div className="p-4 rounded-lg border border-border bg-card">
        <h3 className="text-sm font-medium text-foreground mb-1.5">
          {t.adminSettings.envFallbackTitle}
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          {t.adminSettings.envFallbackDesc}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-2 font-medium text-muted-foreground">{t.adminSettings.envVarFunctionType}</th>
                <th className="text-left py-2 px-2 font-medium text-muted-foreground">{t.adminSettings.envVarUrlKey}</th>
                <th className="text-left py-2 px-2 font-medium text-muted-foreground">{t.adminSettings.envVarApiKeyKey}</th>
                <th className="text-left py-2 px-2 font-medium text-muted-foreground">{t.adminSettings.envVarModelKey}</th>
                <th className="text-left py-2 px-2 font-medium text-muted-foreground">{t.adminSettings.envVarDescription}</th>
              </tr>
            </thead>
            <tbody>
              {envVarMapping.map(row => (
                <tr key={row.ft} className="border-b border-border last:border-b-0">
                  <td className="py-2 px-2">
                    <span className="font-medium text-foreground">{functionTypeLabels[row.ft]}</span>
                    <span className="text-muted-foreground ml-1 font-mono">({row.ft})</span>
                  </td>
                  <td className="py-2 px-2 font-mono text-foreground">{row.urlKey}</td>
                  <td className="py-2 px-2 font-mono text-foreground">{row.apiKeyKey}</td>
                  <td className="py-2 px-2 font-mono text-foreground">{row.modelKey}</td>
                  <td className="py-2 px-2 text-muted-foreground">{t.adminSettings[row.descKey] as string}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section 2: Effective Configuration Overview */}
      <div className="mt-4 p-4 rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="text-sm font-medium text-foreground">
            {t.adminSettings.effectiveConfig}
          </h3>
          <button
            onClick={() => fetchEffectiveConfigs()}
            disabled={loadingEffectiveConfig}
            className="px-2.5 py-1 text-xs font-medium border border-border rounded-md text-foreground hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
          >
            <svg className={`w-3 h-3 ${loadingEffectiveConfig ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {t.adminSettings.effectiveConfigRefresh}
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          {t.adminSettings.effectiveConfigDesc}
        </p>

        {loadingEffectiveConfig ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            {t.adminSettings.effectiveConfigLoading}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-2 font-medium text-muted-foreground">{t.adminSettings.envVarFunctionType}</th>
                  <th className="text-left py-2 px-2 font-medium text-muted-foreground">{t.adminSettings.effectiveConfigUrl}</th>
                  <th className="text-left py-2 px-2 font-medium text-muted-foreground">{t.adminSettings.effectiveConfigModel}</th>
                  <th className="text-left py-2 px-2 font-medium text-muted-foreground">{t.adminSettings.effectiveConfigSource}</th>
                </tr>
              </thead>
              <tbody>
                {FUNCTION_TYPES.map(ft => {
                  const config = effectiveConfigs[ft];
                  const isDb = config?.source === 'database';
                  const isEnv = config?.source === 'environment';
                  return (
                    <tr key={ft} className="border-b border-border last:border-b-0">
                      <td className="py-2 px-2">
                        <span className="font-medium text-foreground">{functionTypeLabels[ft]}</span>
                      </td>
                      <td className="py-2 px-2 text-foreground">
                        {config?.provider_name || (config?.api_url ? truncateUrl(config.api_url, 35) : (
                          <span className="text-muted-foreground italic">{t.adminSettings.effectiveConfigNotConfigured}</span>
                        ))}
                      </td>
                      <td className="py-2 px-2 font-mono text-foreground">
                        {config?.model_name || (
                          <span className="text-muted-foreground italic">-</span>
                        )}
                      </td>
                      <td className="py-2 px-2">
                        <span className={`px-1.5 py-0.5 rounded text-xs ${
                          isDb
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                            : isEnv
                              ? 'bg-muted text-muted-foreground'
                              : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                        }`}>
                          {isDb ? t.adminSettings.configFromDb : isEnv ? t.adminSettings.configFromEnv : t.adminSettings.effectiveConfigNotConfigured}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════
  // Main Render
  // ═══════════════════════════════════════════════════════
  const tabs: { id: TabType; label: string }[] = [
    { id: 'providers', label: t.adminSettings.tabProviders },
    { id: 'assignments', label: t.adminSettings.tabAssignments },
    { id: 'advanced', label: t.adminSettings.tabAdvanced },
  ];

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="p-8 flex justify-center">
        <div className="w-full max-w-2xl space-y-6">

          {/* Tab Navigation */}
          <div className="flex border-b border-border">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
                  activeTab === tab.id
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
                {activeTab === tab.id && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                )}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          {activeTab === 'providers' && renderProvidersTab()}
          {activeTab === 'assignments' && renderAssignmentsTab()}
          {activeTab === 'advanced' && renderAdvancedTab()}

        </div>
      </div>
    </div>
  );
};

export default ModelSettingsPanel;
