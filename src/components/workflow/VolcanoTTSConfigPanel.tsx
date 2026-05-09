'use client';

import React, { useState, useEffect } from 'react';
import { VolcanoTTSNodeConfig, DataFormat } from '@/types';
import NodeTestPanel from './NodeTestPanel';
import FormatSelector from './FormatSelector';
import { http } from '@/lib/api/http-client';
import { useLocale } from '@/contexts/LocaleContext';

interface VolcanoTTSConfigPanelProps {
  nodeId: string;
  config: VolcanoTTSNodeConfig;
  onSave: (config: VolcanoTTSNodeConfig) => void;
  onClose: () => void;
}

interface VoiceTypeInfo {
  id: string;
  name: string;
  language: string;
  gender: string;
  description: string;
  category: string;
}

/**
 * Volcano TTS Configuration Panel Component
 * Figma-style right-side configuration panel for Volcano TTS nodes
 * Allows users to configure text content, voice type, and other TTS parameters
 */
const VolcanoTTSConfigPanel: React.FC<VolcanoTTSConfigPanelProps> = ({
  nodeId,
  config,
  onSave,
  onClose,
}) => {
  console.log('[VolcanoTTSConfigPanel] Rendering panel:', {
    nodeId,
    config,
    initialTextLength: config.text?.length || 0
  });

  const { t } = useLocale();

  // State management
  const [text, setText] = useState(config.text || '');
  const [voiceType, setVoiceType] = useState(config.voiceType || 'zh_male_shaonianzixin_moon_bigtts');
  const [speedRatio, setSpeedRatio] = useState(config.speedRatio || 1.0);
  const [inputFormat, setInputFormat] = useState<DataFormat>(config.inputFormat || 'application/json');
  const [outputFormat, setOutputFormat] = useState<DataFormat>(config.outputFormat || 'application/json');
  const [isSaving, setIsSaving] = useState(false);
  const [voiceTypes, setVoiceTypes] = useState<Record<string, VoiceTypeInfo>>({});
  const [isLoadingVoices, setIsLoadingVoices] = useState(true);
  const [locale, setLocale] = useState<'zh-CN' | 'en'>('zh-CN');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  // Update local state when config changes
  useEffect(() => {
    console.log('[VolcanoTTSConfigPanel] Config updated, refreshing content');
    setText(config.text || '');
    setVoiceType(config.voiceType || 'zh_male_shaonianzixin_moon_bigtts');
    setSpeedRatio(config.speedRatio || 1.0);
    setInputFormat(config.inputFormat || 'application/json');
    setOutputFormat(config.outputFormat || 'application/json');
  }, [config]);

  // Load voice types on mount and when locale changes
  useEffect(() => {
    const loadVoiceTypes = async () => {
      console.log('[VolcanoTTSConfigPanel] Loading voice types for locale:', locale);
      setIsLoadingVoices(true);
      
      try {
        const data = await http.get<any>(`/api/tts/voice-types?locale=${locale}`);

        if (data.success && data.data) {
          console.log('[VolcanoTTSConfigPanel] Voice types loaded successfully:', {
            count: Object.keys(data.data).length,
            locale
          });
          setVoiceTypes(data.data);
        } else {
          console.error('[VolcanoTTSConfigPanel] Failed to load voice types:', data.message);
        }
      } catch (error) {
        console.error('[VolcanoTTSConfigPanel] Error loading voice types:', error);
      } finally {
        setIsLoadingVoices(false);
      }
    };

    loadVoiceTypes();
  }, [locale]);

  // Group voice types by category
  const groupedVoiceTypes = React.useMemo(() => {
    const groups: Record<string, VoiceTypeInfo[]> = {};
    
    Object.values(voiceTypes).forEach((voice) => {
      const category = voice.category || 'Other';
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(voice);
    });
    
    return groups;
  }, [voiceTypes]);

  const handleSave = () => {
    console.log('[VolcanoTTSConfigPanel] Saving configuration:', {
      nodeId,
      textLength: text.length,
      voiceType,
      speedRatio,
      hasText: text.trim().length > 0
    });

    setIsSaving(true);

    const newConfig: VolcanoTTSNodeConfig = {
      text: text.trim(),
      voiceType,
      speedRatio,
      inputFormat,
      outputFormat,
    };

    // Simulate brief save delay for UX feedback
    setTimeout(() => {
      onSave(newConfig);
      setIsSaving(false);
      onClose();
      console.log('[VolcanoTTSConfigPanel] Configuration saved successfully');
    }, 100);
  };

  const handleCancel = () => {
    console.log('[VolcanoTTSConfigPanel] Cancelling configuration, discarding changes');
    onClose();
  };

  const handleClear = () => {
    console.log('[VolcanoTTSConfigPanel] Clearing text content');
    setText('');
  };

  const handlePlayAudio = () => {
    if (audioRef.current) {
      if (isPlayingAudio) {
        audioRef.current.pause();
        setIsPlayingAudio(false);
      } else {
        audioRef.current.play();
        setIsPlayingAudio(true);
      }
    }
  };

  const handleDownloadAudio = () => {
    if (audioUrl) {
      const link = document.createElement('a');
      link.href = audioUrl;
      link.download = `volcano_tts_${nodeId}_${Date.now()}.mp3`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const characterCount = text.length;
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const hasText = text.trim().length > 0;
  const hasValidConfig = hasText && voiceType;

  return (
    <div className="fixed inset-y-0 right-0 w-[35%] bg-card z-50 flex flex-col animate-slide-in-right">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-md bg-orange-600 flex items-center justify-center">
            <svg className="w-5 h-5 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">{t.workflowNodes.configPanels.volcanoTTS.title}</h2>
            <p className="text-xs text-muted-foreground">{t.workflowNodes.configPanels.volcanoTTS.nodeId}: {nodeId}</p>
          </div>
        </div>
        <button
          onClick={handleCancel}
          className="w-8 h-8 rounded-lg hover:bg-accent transition-colors flex items-center justify-center"
          aria-label={t.common.closePanel}
        >
          <svg className="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        {/* Test Panel */}
        <NodeTestPanel
          nodeId={nodeId}
          nodeType="volcano-tts"
          nodeLabel="Volcano TTS"
          nodeConfig={{ text, voiceType, speedRatio }}
          onTest={async (result) => {
            // Handle test result, extract audio URL if available
            if (result.output?.audio_url) {
              console.log('[VolcanoTTSConfigPanel] Audio generated:', result.output.audio_url);
              setAudioUrl(result.output.audio_url);
            }
          }}
        />

        {/* Format Configuration */}
        <div className="space-y-4 p-4 bg-muted border border-border rounded-md">
          <div className="flex items-center space-x-2">
            <svg className="w-5 h-5 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
            </svg>
            <h3 className="text-sm font-semibold text-foreground">{t.workflowNodes.configPanels.volcanoTTS.dataFormat}</h3>
          </div>

          <FormatSelector
            label={t.workflowNodes.configPanels.volcanoTTS.inputFormat}
            value={inputFormat}
            onChange={setInputFormat}
            type="input"
            helpText={t.workflowNodes.configPanels.volcanoTTS.inputFormatHelp}
          />

          <FormatSelector
            label={t.workflowNodes.configPanels.volcanoTTS.outputFormat}
            value={outputFormat}
            onChange={setOutputFormat}
            type="output"
            helpText={t.workflowNodes.configPanels.volcanoTTS.outputFormatHelp}
          />
        </div>

        {/* Language Selection */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground">
            {t.workflowNodes.configPanels.volcanoTTS.language}
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setLocale('zh-CN')}
              className={`px-4 py-2.5 text-sm font-medium rounded-lg transition-colors ${
                locale === 'zh-CN'
                  ? 'bg-orange-500 text-primary-foreground'
                  : 'bg-accent text-foreground hover:bg-secondary'
              }`}
            >
              {t.workflowNodes.configPanels.volcanoTTS.chinese}
            </button>
            <button
              onClick={() => setLocale('en')}
              className={`px-4 py-2.5 text-sm font-medium rounded-lg transition-colors ${
                locale === 'en'
                  ? 'bg-orange-500 text-primary-foreground'
                  : 'bg-accent text-foreground hover:bg-secondary'
              }`}
            >
              {t.workflowNodes.configPanels.volcanoTTS.english}
            </button>
          </div>
        </div>

        {/* Voice Type Selection */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground">
            {t.workflowNodes.configPanels.volcanoTTS.voiceType}
          </label>
          
          {isLoadingVoices ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="ml-2 text-sm text-muted-foreground">{t.workflowNodes.configPanels.volcanoTTS.loadingVoices}</span>
            </div>
          ) : (
            <div className="space-y-4 max-h-64 overflow-y-auto bg-muted border border-border rounded-md p-3">
              {Object.entries(groupedVoiceTypes).map(([category, voices]) => (
                <div key={category} className="space-y-2">
                  <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide">
                    {category}
                  </h4>
                  <div className="space-y-1">
                    {voices.map((voice) => (
                      <button
                        key={voice.id}
                        onClick={() => setVoiceType(voice.id)}
                        className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors ${
                          voiceType === voice.id
                            ? 'bg-orange-500 text-primary-foreground'
                            : 'bg-card text-foreground hover:bg-accent border border-border'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">{voice.name}</div>
                            <div className={`text-xs mt-0.5 truncate ${
                              voiceType === voice.id ? 'text-orange-100' : 'text-muted-foreground'
                            }`}>
                              {voice.description}
                            </div>
                          </div>
                          <div className={`ml-2 px-2 py-0.5 rounded text-xs font-medium ${
                            voiceType === voice.id
                              ? 'bg-orange-400/30 text-primary-foreground'
                              : voice.gender === 'male'
                                ? 'bg-primary/10 text-primary'
                                : 'bg-pink-100 text-pink-700'
                          }`}>
                            {voice.gender === 'male' ? '♂' : '♀'}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Speed Ratio */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-foreground">
              {t.workflowNodes.configPanels.volcanoTTS.speedRatio}
            </label>
            <span className="text-sm font-semibold text-primary">{speedRatio.toFixed(1)}x</span>
          </div>
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.1"
            value={speedRatio}
            onChange={(e) => setSpeedRatio(parseFloat(e.target.value))}
            className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0.5x (Slower)</span>
            <span>1.0x (Normal)</span>
            <span>2.0x (Faster)</span>
          </div>
        </div>
        
        {/* Text Input Area */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-foreground">
              Text Content
            </label>
            {hasText && (
              <button
                onClick={handleClear}
                className="text-xs text-red-600 hover:text-red-700 font-medium transition-colors"
              >
                Clear
              </button>
            )}
          </div>
          <textarea
            value={text}
            onChange={(e) => {
              console.log('[VolcanoTTSConfigPanel] Content changed, new length:', e.target.value.length);
              setText(e.target.value);
            }}
            placeholder="Enter the text you want to convert to speech...

Examples:
• Welcome to our video tutorial.
• Today we'll learn about AI and machine learning.
• 欢迎来到我们的视频教程。
• 今天我们将学习人工智能和机器学习。

The text will be converted to speech using the selected voice type."
            rows={12}
            className="w-full px-4 py-3 bg-muted border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-colors resize-none text-sm text-foreground placeholder-muted-foreground"
          />
          
          {/* Character/Word Count */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center space-x-4">
              <span>{characterCount} character{characterCount !== 1 ? 's' : ''}</span>
              <span>•</span>
              <span>{wordCount} word{wordCount !== 1 ? 's' : ''}</span>
            </div>
            {hasText ? (
              <span className="text-primary font-medium flex items-center">
                <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Has content
              </span>
            ) : (
              <span className="text-muted-foreground">Empty</span>
            )}
          </div>
        </div>

        {/* Audio Preview Section */}
        {audioUrl && (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground">
              Audio Preview
            </label>
            <div className="bg-primary/10 border border-primary/30 rounded-md p-4 space-y-3">
              <audio
                ref={audioRef}
                src={audioUrl}
                onEnded={() => setIsPlayingAudio(false)}
                onPause={() => setIsPlayingAudio(false)}
                className="w-full"
              />
              <div className="flex items-center space-x-2">
                <button
                  onClick={handlePlayAudio}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-primary-foreground bg-orange-500 rounded-lg hover:bg-orange-600 transition-colors flex items-center justify-center space-x-2"
                >
                  {isPlayingAudio ? (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>Pause</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>Play Audio</span>
                    </>
                  )}
                </button>
                <button
                  onClick={handleDownloadAudio}
                  className="px-4 py-2.5 text-sm font-medium text-primary bg-card border border-border rounded-lg hover:bg-accent transition-colors flex items-center space-x-2"
                  title="Download Audio"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span>Download</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Info Box */}
        <div className="bg-primary/10 border border-primary/30 rounded-md p-4">
          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0">
              <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-foreground mb-1">How to use</h4>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>• Select your preferred voice type from the list</li>
                <li>• Enter the text you want to convert to speech</li>
                <li>• Adjust the speed ratio if needed (0.5x - 2.0x)</li>
                <li>• Use the Test & Debug panel to preview the audio</li>
                <li>• Connect the output to other nodes to use the generated audio</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-border bg-muted">
        <div className="flex items-center justify-end space-x-3">
          <button
            onClick={handleCancel}
            disabled={isSaving}
            className="px-5 py-2.5 text-sm font-medium text-foreground bg-card border border-border rounded-lg hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || !hasValidConfig}
            className="px-5 py-2.5 text-sm font-medium text-primary-foreground bg-primary hover:bg-[var(--primary-hover)] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
          >
            {isSaving ? (
              <>
                <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Save Configuration</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default VolcanoTTSConfigPanel;

