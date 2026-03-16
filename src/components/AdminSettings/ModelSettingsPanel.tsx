'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';

type FunctionType = 'chat' | 'fast' | 'video_cut' | 'vision';

interface KnownProvider {
  id: string;
  name: string;
  default_api_url: string;
  region: string;
}

interface SavedProvider {
  id: number;
  name: string;
  provider_type: string;
  api_url: string;
  api_key_masked: string;
  api_key_set: boolean;
  created_at: string | null;
  updated_at: string | null;
}

interface ProviderWithModels extends SavedProvider {
  models: string[];
  modelsFetched: boolean;
}

interface Assignment {
  function_type: FunctionType;
  provider_id: number;
  provider_name: string;
  provider_type: string;
  model_name: string;
  temperature: number;
  max_tokens: number;
  updated_at: string | null;
}

interface ProviderFormState {
  id: number | null; // null = creating new
  name: string;
  provider_type: string;
  api_url: string;
  api_key: string;
  api_key_changed: boolean;
}

interface AssignmentFormState {
  provider_id: number | null;
  model_name: string;
  temperature: number;
  modelInputMode: 'select' | 'manual';
}

interface TestResult {
  success: boolean;
  message: string;
  latency_ms?: number;
}

const FUNCTION_TYPES: FunctionType[] = ['chat', 'fast', 'video_cut', 'vision'];

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

const ModelSettingsPanel: React.FC = () => {
  const { t } = useLocale();
  const { showSuccess, showError } = useNotification();

  // ── Data State ──
  const [knownProviders, setKnownProviders] = useState<KnownProvider[]>([]);
  const [savedProviders, setSavedProviders] = useState<ProviderWithModels[]>([]);
  const [assignments, setAssignments] = useState<Record<FunctionType, Assignment | null>>({
    chat: null, fast: null, video_cut: null, vision: null,
  });
  const [loading, setLoading] = useState(true);

  // ── Provider Form State ──
  const [providerForm, setProviderForm] = useState<ProviderFormState | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [savingProvider, setSavingProvider] = useState(false);
  const [fetchingModels, setFetchingModels] = useState<number | 'new' | null>(null);
  const [testingProvider, setTestingProvider] = useState<number | 'new' | null>(null);
  const [providerTestResult, setProviderTestResult] = useState<TestResult | null>(null);

  // ── Assignment Form State ──
  const [assignmentForms, setAssignmentForms] = useState<Record<FunctionType, AssignmentFormState>>({
    chat: { provider_id: null, model_name: '', temperature: 0.7, modelInputMode: 'select' },
    fast: { provider_id: null, model_name: '', temperature: 0.7, modelInputMode: 'select' },
    video_cut: { provider_id: null, model_name: '', temperature: 0.7, modelInputMode: 'select' },
    vision: { provider_id: null, model_name: '', temperature: 0.7, modelInputMode: 'select' },
  });
  const [savingAssignment, setSavingAssignment] = useState<FunctionType | null>(null);

  // ── Unsaved provider models cache ──
  const [newProviderModels, setNewProviderModels] = useState<string[]>([]);

  // ── Expanded model lists ──
  const [expandedProviderModels, setExpandedProviderModels] = useState<number | null>(null);

  // ── Delete Confirmation ──
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const tabLabels: Record<FunctionType, string> = {
    chat: t.adminSettings.modelChat,
    fast: t.adminSettings.modelFast,
    video_cut: t.adminSettings.modelVideoCut,
    vision: t.adminSettings.modelVision,
  };

  // ── Data Fetching ──
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [knownRes, savedRes, assignRes] = await Promise.all([
        fetch('/api/model-settings/providers'),
        fetch('/api/model-settings/providers/saved'),
        fetch('/api/model-settings/assignments'),
      ]);
      const knownData = await knownRes.json();
      const savedData = await savedRes.json();
      const assignData = await assignRes.json();

      if (knownData.success) {
        setKnownProviders(knownData.providers);
      }

      const providersWithModels: ProviderWithModels[] = [];
      if (savedData.success) {
        for (const p of savedData.providers) {
          providersWithModels.push({ ...p, models: [], modelsFetched: false });
        }
      }
      setSavedProviders(providersWithModels);

      if (assignData.success) {
        const assignMap: Record<FunctionType, Assignment | null> = {
          chat: null, fast: null, video_cut: null, vision: null,
        };
        const formUpdates: Record<FunctionType, AssignmentFormState> = {
          chat: { provider_id: null, model_name: '', temperature: 0.7, modelInputMode: 'select' },
          fast: { provider_id: null, model_name: '', temperature: 0.7, modelInputMode: 'select' },
          video_cut: { provider_id: null, model_name: '', temperature: 0.7, modelInputMode: 'select' },
          vision: { provider_id: null, model_name: '', temperature: 0.7, modelInputMode: 'select' },
        };
        for (const a of assignData.assignments) {
          const ft = a.function_type as FunctionType;
          assignMap[ft] = a;
          formUpdates[ft] = {
            provider_id: a.provider_id,
            model_name: a.model_name,
            temperature: a.temperature,
            modelInputMode: 'select',
          };
        }
        setAssignments(assignMap);
        setAssignmentForms(formUpdates);
      }
    } catch {
      showError(t.adminSettings.modelSaveError);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
      });
    } else {
      setProviderForm({
        id: null,
        name: '',
        provider_type: '',
        api_url: '',
        api_key: '',
        api_key_changed: true,
      });
    }
    setShowApiKey(false);
    setProviderTestResult(null);
    setNewProviderModels([]);
  };

  const handleProviderTypeSelect = (providerTypeId: string) => {
    const known = knownProviders.find(p => p.id === providerTypeId);
    if (known) {
      setProviderForm(prev => prev ? {
        ...prev,
        provider_type: known.id,
        api_url: known.default_api_url,
        name: prev.name || known.name,
      } : null);
    } else {
      setProviderForm(prev => prev ? { ...prev, provider_type: providerTypeId } : null);
    }
  };

  const handleSaveProvider = async () => {
    if (!providerForm || !providerForm.name || !providerForm.api_url) return;

    setSavingProvider(true);
    try {
      let res: Response;
      if (providerForm.id) {
        // Update
        res = await fetch(`/api/model-settings/providers/${providerForm.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: providerForm.name,
            provider_type: providerForm.provider_type,
            api_url: providerForm.api_url,
            api_key: ***REMOVED*** ? providerForm.api_key : '__KEEP__',
          }),
        });
      } else {
        // Create
        if (!providerForm.api_key) {
          showError('API Key is required');
          setSavingProvider(false);
          return;
        }
        res = await fetch('/api/model-settings/providers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: providerForm.name,
            provider_type: providerForm.provider_type || 'custom',
            api_url: providerForm.api_url,
            api_key: providerForm.api_key,
          }),
        });
      }
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccess(t.adminSettings.modelProviderSaved);
        setProviderForm(null);
        await fetchData();
      } else {
        showError(data.detail || data.message || t.adminSettings.modelProviderCreateError);
      }
    } catch {
      showError(t.adminSettings.modelProviderCreateError);
    } finally {
      setSavingProvider(false);
    }
  };

  const handleDeleteProvider = async (providerId: number) => {
    try {
      const res = await fetch(`/api/model-settings/providers/${providerId}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccess(t.adminSettings.modelProviderDeleted);
        setDeleteConfirmId(null);
        await fetchData();
      } else {
        showError(data.detail || 'Failed to delete provider');
      }
    } catch {
      showError('Failed to delete provider');
    }
  };

  const handleFetchModelsForProvider = async (providerId: number | 'new') => {
    setFetchingModels(providerId);
    try {
      let res: Response;
      if (providerId === 'new' && providerForm) {
        // Fetch for unsaved provider using ad-hoc credentials
        res = await fetch('/api/model-settings/fetch-models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_url: providerForm.api_url,
            api_key: providerForm.api_key,
          }),
        });
      } else {
        res = await fetch(`/api/model-settings/providers/${providerId}/fetch-models`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const data = await res.json();
      if (data.success && data.models.length > 0) {
        if (providerId === 'new') {
          setNewProviderModels(data.models);
          showSuccess(`${data.models.length} models found`);
        } else {
          setSavedProviders(prev => prev.map(p =>
            p.id === providerId ? { ...p, models: data.models, modelsFetched: true } : p
          ));
        }
      } else {
        showError(data.message || t.adminSettings.modelFetchModelsError);
      }
    } catch {
      showError(t.adminSettings.modelFetchModelsError);
    } finally {
      setFetchingModels(null);
    }
  };

  const handleTestProviderConnection = async (providerId: number | 'new', modelName?: string) => {
    setTestingProvider(providerId);
    setProviderTestResult(null);

    let api_url = '';
    let api_key = '';

    if (providerId === 'new' && providerForm) {
      api_url = providerForm.api_url;
      api_key = providerForm.api_key;
    } else {
      const provider = savedProviders.find(p => p.id === providerId);
      if (!provider) return;
      api_url = provider.api_url;
    }

    try {
      const res = await fetch('/api/model-settings/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_url,
          api_key,
          model_name: modelName || 'test',
          provider_id: providerId === 'new' ? undefined : providerId,
        }),
      });
      const data = await res.json();
      setProviderTestResult(data);
    } catch {
      setProviderTestResult({ success: false, message: 'Request failed' });
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

  const handleAssignmentProviderChange = async (ft: FunctionType, providerId: number) => {
    updateAssignmentForm(ft, { provider_id: providerId, model_name: '', modelInputMode: 'select' });
    // Auto-fetch models for this provider if not yet fetched
    const provider = savedProviders.find(p => p.id === providerId);
    if (provider && !provider.modelsFetched) {
      await handleFetchModelsForProvider(providerId);
    }
  };

  const handleSaveAssignment = async (ft: FunctionType) => {
    const form = assignmentForms[ft];
    if (!form.provider_id || !form.model_name) return;

    setSavingAssignment(ft);
    try {
      const res = await fetch('/api/model-settings/assignments', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          function_type: ft,
          provider_id: form.provider_id,
          model_name: form.model_name,
          temperature: form.temperature,
          max_tokens: 128000,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccess(t.adminSettings.modelAssignmentSaved);
        await fetchData();
      } else {
        showError(data.detail || t.adminSettings.modelSaveError);
      }
    } catch {
      showError(t.adminSettings.modelSaveError);
    } finally {
      setSavingAssignment(null);
    }
  };

  const handleResetAssignment = async (ft: FunctionType) => {
    try {
      const res = await fetch(`/api/model-settings/assignments/${ft}`, { method: 'DELETE' });
      if (res.ok) {
        showSuccess(t.adminSettings.modelAssignmentDeleted);
        updateAssignmentForm(ft, { provider_id: null, model_name: '', temperature: 0.7, modelInputMode: 'select' });
        setAssignments(prev => ({ ...prev, [ft]: null }));
      }
    } catch {
      showError(t.adminSettings.modelSaveError);
    }
  };

  // ── Helpers ──
  const getProviderModels = (providerId: number | null): string[] => {
    if (!providerId) return [];
    const provider = savedProviders.find(p => p.id === providerId);
    return provider?.models || [];
  };

  const getAssignmentsForProvider = (providerId: number): FunctionType[] => {
    return FUNCTION_TYPES.filter(ft => assignments[ft]?.provider_id === providerId);
  };

  const getProviderTypeBadge = (providerType: string) => {
    const known = knownProviders.find(p => p.id === providerType);
    return known?.name || providerType || 'Custom';
  };

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

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="p-8 flex justify-center">
        <div className="w-full max-w-2xl space-y-10">

          {/* ═══════════════════════════════════════════
              Section 1: Provider Management
              ═══════════════════════════════════════════ */}
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
              {savedProviders.map(provider => (
                <div
                  key={provider.id}
                  className="p-4 rounded-lg border border-border bg-card"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground text-sm">{provider.name}</span>
                          <span className="px-1.5 py-0.5 text-xs rounded bg-muted text-muted-foreground">
                            {getProviderTypeBadge(provider.provider_type)}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {provider.api_url}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleFetchModelsForProvider(provider.id)}
                        disabled={fetchingModels === provider.id}
                        className="px-2 py-1 text-xs font-medium border border-border rounded text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
                      >
                        {fetchingModels === provider.id ? t.adminSettings.modelFetchingModels : t.adminSettings.modelFetchModels}
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
                  {/* Delete warning when provider is in use */}
                  {deleteConfirmId === provider.id && (() => {
                    const affected = getAssignmentsForProvider(provider.id);
                    return affected.length > 0 ? (
                      <div className="mt-2 px-2 py-1.5 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded">
                        {t.adminSettings.modelDeleteProviderConfirm}
                        {' '}({affected.map(ft => tabLabels[ft]).join(', ')})
                      </div>
                    ) : null;
                  })()}
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
                        {provider.models.length} models
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
              ))}

              {savedProviders.length === 0 && !providerForm && (
                <div className="p-6 text-center text-sm text-muted-foreground border border-dashed border-border rounded-lg">
                  {t.adminSettings.modelNoProviders}
                </div>
              )}
            </div>

            {/* Provider Add/Edit Form */}
            {providerForm && (
              <div className="mt-4 p-4 rounded-lg border border-primary/30 bg-card space-y-4">
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
                    onChange={e => setProviderForm(prev => prev ? { ...prev, api_url: e.target.value } : null)}
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

                {/* Fetched models list (for new/editing provider) */}
                {(() => {
                  const models = providerForm.id
                    ? (savedProviders.find(p => p.id === providerForm.id)?.models || [])
                    : newProviderModels;
                  return models.length > 0 ? (
                    <div>
                      <button
                        type="button"
                        onClick={() => setExpandedProviderModels(
                          expandedProviderModels === (providerForm.id || -1) ? null : (providerForm.id || -1)
                        )}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                      >
                        <svg
                          className={`w-3 h-3 transition-transform ${expandedProviderModels === (providerForm.id || -1) ? 'rotate-90' : ''}`}
                          fill="none" stroke="currentColor" viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        {models.length} models
                      </button>
                      {expandedProviderModels === (providerForm.id || -1) && (
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

                {/* Test Connection (for provider form) */}
                {providerTestResult && (
                  <div className={`text-sm flex items-center gap-1.5 ${providerTestResult.success ? 'text-green-500' : 'text-destructive'}`}>
                    {providerTestResult.success ? <CheckIcon /> : <XIcon />}
                    {providerTestResult.success
                      ? `${t.adminSettings.modelTestSuccess} (${providerTestResult.latency_ms}ms)`
                      : `${t.adminSettings.modelTestFailed}: ${providerTestResult.message}`
                    }
                  </div>
                )}

                {/* Form Actions */}
                <div className="flex items-center justify-between pt-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleTestProviderConnection(providerForm.id || 'new')}
                      disabled={testingProvider !== null || !providerForm.api_url || (!providerForm.api_key && !providerForm.id)}
                      className="px-3 py-1.5 text-sm font-medium border border-border rounded-md text-foreground hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {testingProvider ? t.adminSettings.modelTesting : t.adminSettings.modelTestConnection}
                    </button>
                    {providerForm.api_key && providerForm.api_url && (
                      <button
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
                      onClick={() => { setProviderForm(null); setProviderTestResult(null); }}
                      className="px-3 py-1.5 text-sm font-medium border border-border rounded-md text-foreground hover:bg-accent transition-colors"
                    >
                      {t.adminSettings.cancel}
                    </button>
                    <button
                      onClick={handleSaveProvider}
                      disabled={savingProvider || !providerForm.name || !providerForm.api_url}
                      className="px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {savingProvider ? t.adminSettings.modelSaving : t.adminSettings.modelSave}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ═══════════════════════════════════════════
              Section 2: Feature Model Assignment
              ═══════════════════════════════════════════ */}
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
                          <h3 className="text-sm font-medium text-foreground">{tabLabels[ft]}</h3>
                          <span className={`w-2 h-2 rounded-full ${saved ? 'bg-green-500' : 'bg-muted-foreground'}`} />
                          <span className="text-xs text-muted-foreground">
                            {saved ? t.adminSettings.modelUsingDb : t.adminSettings.modelUsingEnv}
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
                              const id = parseInt(e.target.value);
                              if (!isNaN(id)) {
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
                            {models.length > 0 && (
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
                            )}
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
        </div>
      </div>
    </div>
  );
};

export default ModelSettingsPanel;
