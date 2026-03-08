'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';

type FunctionType = 'chat' | 'fast' | 'video_cut' | 'vision';

interface ProviderInfo {
  id: string;
  name: string;
  default_api_url: string;
  region: string;
}

interface ModelSetting {
  function_type: FunctionType;
  is_custom: boolean;
  provider: string | null;
  model_name: string;
  api_url: string;
  api_key_masked: string;
  api_key_set: boolean;
  temperature: number;
  max_tokens: number;
  updated_at: string | null;
}

interface FormState {
  is_custom: boolean;
  provider: string;
  model_name: string;
  api_url: string;
  api_key: string;
  temperature: number;
  api_key_changed: boolean;
}

interface TestResult {
  success: boolean;
  message: string;
  latency_ms?: number;
}

const FUNCTION_TABS: FunctionType[] = ['chat', 'fast', 'video_cut', 'vision'];

const DEFAULT_FORM: FormState = {
  is_custom: false,
  provider: '',
  model_name: '',
  api_url: '',
  api_key: '',
  temperature: 0.7,
  api_key_changed: false,
};

/* ── Eye toggle icons ── */
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

const ModelSettingsPanel: React.FC = () => {
  const { t } = useLocale();
  const { showSuccess, showError } = useNotification();

  const [activeTab, setActiveTab] = useState<FunctionType>('chat');
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [savedSettings, setSavedSettings] = useState<Record<string, ModelSetting>>({});
  const [forms, setForms] = useState<Record<FunctionType, FormState>>({
    chat: { ...DEFAULT_FORM },
    fast: { ...DEFAULT_FORM },
    video_cut: { ...DEFAULT_FORM },
    vision: { ...DEFAULT_FORM },
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);

  // Dynamic model list fetched from provider API
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelInputMode, setModelInputMode] = useState<'select' | 'manual'>('select');

  // Use ref for forms inside fetchData to avoid stale closure
  const formsRef = useRef(forms);
  formsRef.current = forms;

  const tabLabels: Record<FunctionType, string> = {
    chat: t.adminSettings.modelChat,
    fast: t.adminSettings.modelFast,
    video_cut: t.adminSettings.modelVideoCut,
    vision: t.adminSettings.modelVision,
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsRes, providersRes] = await Promise.all([
        fetch('/api/model-settings'),
        fetch('/api/model-settings/providers'),
      ]);
      const settingsData = await settingsRes.json();
      const providersData = await providersRes.json();

      if (providersData.success) {
        setProviders(providersData.providers);
      }

      if (settingsData.success) {
        const settingsMap: Record<string, ModelSetting> = {};
        const currentForms = formsRef.current;
        const newForms = {
          chat: { ...currentForms.chat },
          fast: { ...currentForms.fast },
          video_cut: { ...currentForms.video_cut },
          vision: { ...currentForms.vision },
        };

        for (const s of settingsData.settings) {
          settingsMap[s.function_type] = s;
          newForms[s.function_type as FunctionType] = {
            is_custom: s.is_custom,
            provider: s.provider || '',
            model_name: s.model_name,
            api_url: s.api_url,
            api_key: '',
            temperature: s.temperature,
            api_key_changed: false,
          };
        }
        setSavedSettings(settingsMap);
        setForms(newForms);
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

  const currentForm = forms[activeTab];
  const currentSaved = savedSettings[activeTab];

  const updateForm = (updates: Partial<FormState>) => {
    setForms(prev => ({
      ...prev,
      [activeTab]: { ...prev[activeTab], ...updates },
    }));
    setTestResult(null);
  };

  const handleProviderSelect = (providerName: string) => {
    const provider = providers.find(p => p.name === providerName);
    if (provider) {
      updateForm({
        provider: provider.name,
        api_url: provider.default_api_url,
        model_name: '',
      });
    } else {
      updateForm({ provider: '', api_url: '', model_name: '' });
    }
    setFetchedModels([]);
    setModelInputMode('select');
  };

  const handleFetchModels = async () => {
    const form = forms[activeTab];
    if (!form.api_url) return;

    const apiKey = form.api_key_changed ? form.api_key : '';
    if (!apiKey && !currentSaved?.api_key_set) {
      showError('API Key is required');
      return;
    }

    setFetchingModels(true);
    setFetchedModels([]);
    try {
      const res = await fetch('/api/model-settings/fetch-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_url: form.api_url,
          api_key: apiKey || '__USE_SAVED__',
          function_type: activeTab,
        }),
      });
      const data = await res.json();
      if (data.success && data.models.length > 0) {
        setFetchedModels(data.models);
        setModelInputMode('select');
      } else {
        showError(data.message || t.adminSettings.modelFetchModelsError);
        setModelInputMode('manual');
      }
    } catch {
      showError(t.adminSettings.modelFetchModelsError);
      setModelInputMode('manual');
    } finally {
      setFetchingModels(false);
    }
  };

  const handleModeChange = (isCustom: boolean) => {
    if (isCustom) {
      updateForm({ is_custom: true, provider: '', model_name: '', api_url: '', api_key: '', api_key_changed: false });
    } else {
      updateForm({ is_custom: false, api_key: '', api_key_changed: false });
    }
    setFetchedModels([]);
    setModelInputMode('select');
  };

  const handleSave = async () => {
    const form = forms[activeTab];
    if (!form.model_name || !form.api_url) return;

    const apiKeyToSend = form.api_key_changed ? form.api_key : (currentSaved?.api_key_set ? '__KEEP__' : '');
    if (!form.api_key_changed && !currentSaved?.api_key_set) {
      showError('API Key is required');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/model-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          function_type: activeTab,
          is_custom: form.is_custom,
          provider: form.provider || null,
          model_name: form.model_name,
          api_url: form.api_url,
          api_key: apiKeyToSend,
          temperature: form.temperature,
          max_tokens: 128000,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showSuccess(t.adminSettings.modelSaveSuccess);
        await fetchData();
      } else {
        showError(data.detail || t.adminSettings.modelSaveError);
      }
    } catch {
      showError(t.adminSettings.modelSaveError);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    try {
      const res = await fetch(`/api/model-settings/${activeTab}`, { method: 'DELETE' });
      if (res.ok) {
        showSuccess(t.adminSettings.modelResetToDefault);
        setForms(prev => ({ ...prev, [activeTab]: { ...DEFAULT_FORM } }));
        setSavedSettings(prev => {
          const next = { ...prev };
          delete next[activeTab];
          return next;
        });
        setTestResult(null);
        setFetchedModels([]);
      }
    } catch {
      showError(t.adminSettings.modelSaveError);
    }
  };

  const handleTestConnection = async () => {
    const form = forms[activeTab];
    if (!form.api_url || !form.model_name) return;

    const apiKey = form.api_key_changed ? form.api_key : '';
    if (!apiKey && !currentSaved?.api_key_set) {
      showError('API Key is required for testing');
      return;
    }

    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/model-settings/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_url: form.api_url,
          api_key: apiKey,
          model_name: form.model_name,
          function_type: activeTab,
        }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch {
      setTestResult({ success: false, message: 'Request failed' });
    } finally {
      setTesting(false);
    }
  };

  // Group providers by region
  const domesticProviders = providers.filter(p => p.region === 'domestic');
  const internationalProviders = providers.filter(p => p.region === 'international');

  /* ── Shared API Key input ── */
  const renderApiKeyInput = () => (
    <div>
      <label className="block text-sm font-medium text-foreground mb-2">
        {t.adminSettings.modelApiKey}
      </label>
      <div className="relative">
        <input
          type={showApiKey ? 'text' : 'password'}
          value={***REMOVED*** ? currentForm.api_key : (currentSaved?.api_key_masked || '')}
          onChange={(e) => updateForm({ api_key: e.target.value, api_key_changed: true })}
          onFocus={() => {
            if (!***REMOVED***) {
              updateForm({ api_key: '', api_key_changed: true });
            }
          }}
          placeholder={currentSaved?.api_key_set ? '••••••••' : t.adminSettings.modelApiKeyPlaceholder}
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
  );

  /* ── Model name: dropdown from fetched list or manual input ── */
  const renderModelSelector = () => (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-sm font-medium text-foreground">
          {t.adminSettings.modelName}
        </label>
        {fetchedModels.length > 0 && (
          <button
            type="button"
            onClick={() => setModelInputMode(prev => prev === 'select' ? 'manual' : 'select')}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {modelInputMode === 'select' ? t.adminSettings.modelOrInputManually : t.adminSettings.modelSelectModel}
          </button>
        )}
      </div>
      {modelInputMode === 'select' && fetchedModels.length > 0 ? (
        <select
          value={currentForm.model_name}
          onChange={(e) => updateForm({ model_name: e.target.value })}
          className="block w-full px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm focus:ring-2 focus:ring-ring focus:border-ring"
        >
          <option value="">{t.adminSettings.modelSelectModel}</option>
          {fetchedModels.map(model => (
            <option key={model} value={model}>{model}</option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={currentForm.model_name}
          onChange={(e) => updateForm({ model_name: e.target.value })}
          placeholder={t.adminSettings.modelNamePlaceholder}
          className="block w-full px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm focus:ring-2 focus:ring-ring focus:border-ring"
        />
      )}
    </div>
  );

  /* ── Fetch Models button ── */
  const renderFetchModelsButton = () => {
    const hasApiKey = ***REMOVED*** ? !!currentForm.api_key : !!currentSaved?.api_key_set;
    return (
      <div className="flex items-center gap-3">
        <button
          onClick={handleFetchModels}
          disabled={fetchingModels || !currentForm.api_url || !hasApiKey}
          className="px-3 py-1.5 text-sm font-medium border border-border rounded-md text-foreground hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {fetchingModels ? t.adminSettings.modelFetchingModels : t.adminSettings.modelFetchModels}
        </button>
        {fetchedModels.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {fetchedModels.length} models
          </span>
        )}
        {!hasApiKey && currentForm.api_url && (
          <span className="text-xs text-muted-foreground">
            {t.adminSettings.modelFetchModelsHint}
          </span>
        )}
      </div>
    );
  };

  /* ── Shared Test Connection button + result ── */
  const renderTestConnection = () => (
    <div className="flex items-center gap-3">
      <button
        onClick={handleTestConnection}
        disabled={testing || !currentForm.api_url || !currentForm.model_name}
        className="px-3 py-1.5 text-sm font-medium border border-border rounded-md text-foreground hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {testing ? t.adminSettings.modelTesting : t.adminSettings.modelTestConnection}
      </button>
      {testResult && (
        <span className={`text-sm flex items-center gap-1.5 ${testResult.success ? 'text-green-500' : 'text-destructive'}`}>
          {testResult.success ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
          {testResult.success
            ? `${t.adminSettings.modelTestSuccess} (${testResult.latency_ms}ms)`
            : `${t.adminSettings.modelTestFailed}: ${testResult.message}`
          }
        </span>
      )}
    </div>
  );

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
        <div className="w-full max-w-2xl">
          {/* Header */}
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-2">
              {t.adminSettings.modelSettings}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t.adminSettings.modelSettingsDesc}
            </p>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-border mb-6">
            {FUNCTION_TABS.map(tab => (
              <button
                key={tab}
                onClick={() => { setActiveTab(tab); setTestResult(null); setShowApiKey(false); setFetchedModels([]); }}
                className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
                  activeTab === tab
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <span className="flex items-center gap-2">
                  {tabLabels[tab]}
                  {savedSettings[tab] && (
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                  )}
                </span>
                {activeTab === tab && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                )}
              </button>
            ))}
          </div>

          {/* Mode Toggle */}
          <div className="flex gap-4 mb-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="mode"
                checked={!currentForm.is_custom}
                onChange={() => handleModeChange(false)}
                className="w-4 h-4 text-primary accent-primary"
              />
              <span className="text-sm font-medium text-foreground">
                {t.adminSettings.modelPreset}
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="mode"
                checked={currentForm.is_custom}
                onChange={() => handleModeChange(true)}
                className="w-4 h-4 text-primary accent-primary"
              />
              <span className="text-sm font-medium text-foreground">
                {t.adminSettings.modelCustom}
              </span>
            </label>
          </div>

          {/* Preset Provider Selection */}
          {!currentForm.is_custom && (
            <div className="space-y-4 mb-6 p-4 rounded-lg border border-border bg-card">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {t.adminSettings.modelProvider}
                </label>
                <select
                  value={currentForm.provider}
                  onChange={(e) => handleProviderSelect(e.target.value)}
                  className="block w-full px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm focus:ring-2 focus:ring-ring focus:border-ring"
                >
                  <option value="">{t.adminSettings.modelSelectProvider}</option>
                  {domesticProviders.length > 0 && (
                    <optgroup label={t.adminSettings.modelDomestic}>
                      {domesticProviders.map(p => (
                        <option key={p.id} value={p.name}>{p.name}</option>
                      ))}
                    </optgroup>
                  )}
                  {internationalProviders.length > 0 && (
                    <optgroup label={t.adminSettings.modelInternational}>
                      {internationalProviders.map(p => (
                        <option key={p.id} value={p.name}>{p.name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              {currentForm.provider && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      {t.adminSettings.modelApiUrl}
                    </label>
                    <input
                      type="text"
                      value={currentForm.api_url}
                      onChange={(e) => updateForm({ api_url: e.target.value })}
                      placeholder={t.adminSettings.modelApiUrlPlaceholder}
                      className="block w-full px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm focus:ring-2 focus:ring-ring focus:border-ring"
                    />
                  </div>

                  {renderApiKeyInput()}
                  {renderFetchModelsButton()}
                  {renderModelSelector()}
                  {renderTestConnection()}
                </>
              )}
            </div>
          )}

          {/* Custom Model Configuration */}
          {currentForm.is_custom && (
            <div className="space-y-4 mb-6 p-4 rounded-lg border border-border bg-card">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {t.adminSettings.modelApiUrl}
                </label>
                <input
                  type="text"
                  value={currentForm.api_url}
                  onChange={(e) => updateForm({ api_url: e.target.value })}
                  placeholder={t.adminSettings.modelApiUrlPlaceholder}
                  className="block w-full px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm focus:ring-2 focus:ring-ring focus:border-ring"
                />
              </div>

              {renderApiKeyInput()}
              {renderFetchModelsButton()}
              {renderModelSelector()}
              {renderTestConnection()}
            </div>
          )}

          {/* Parameters */}
          <div className="mb-6 p-4 rounded-lg border border-border bg-card">
            <h3 className="text-sm font-medium text-foreground mb-4">
              {t.adminSettings.modelParameters}
            </h3>
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-foreground">
                    {t.adminSettings.modelTemperature}
                  </label>
                  <span className="text-sm text-muted-foreground font-mono">
                    {currentForm.temperature.toFixed(1)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={currentForm.temperature}
                  onChange={(e) => updateForm({ temperature: parseFloat(e.target.value) })}
                  className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-muted accent-primary"
                />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>0.0</span>
                  <span>1.0</span>
                  <span>2.0</span>
                </div>
              </div>

            </div>
          </div>

          {/* Status */}
          <div className="flex items-center gap-2 mb-6 text-sm">
            <span className={`w-2 h-2 rounded-full ${currentSaved ? 'bg-green-500' : 'bg-muted-foreground'}`} />
            <span className="text-muted-foreground">
              {currentSaved ? t.adminSettings.modelUsingDb : t.adminSettings.modelUsingEnv}
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-6 border-t border-border">
            <button
              onClick={handleReset}
              disabled={!currentSaved}
              className="px-4 py-2 text-sm font-medium border border-border rounded-md text-foreground hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {t.adminSettings.modelResetToDefault}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !currentForm.model_name || !currentForm.api_url}
              className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? t.adminSettings.modelSaving : t.adminSettings.modelSave}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModelSettingsPanel;
