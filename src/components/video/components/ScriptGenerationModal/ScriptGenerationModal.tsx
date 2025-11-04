'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { ScriptGenerationConfig } from '@/types';
import { VideoEditingLogger } from '../../utils';
import { useLocale } from '@/contexts/LocaleContext';
import { getTranslations } from '@/lib/i18n';
import styles from './ScriptGenerationModal.module.css';

interface ScriptGenerationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (config: ScriptGenerationConfig) => void;
  taskId: string;
}

const ScriptGenerationModal: React.FC<ScriptGenerationModalProps> = ({
  isOpen,
  onClose,
  onGenerate,
  taskId
}) => {
  // 获取国际化上下文
  const { locale } = useLocale();
  const t = getTranslations(locale);
  
  // 配置状态
  const [config, setConfig] = useState<ScriptGenerationConfig>({
    language: 'chinese',
    consistency: 'moderate',
    segmentCount: 5,
    customRequirements: ''
  });

  const logger = new VideoEditingLogger({
    taskId,
    component: 'ScriptGenerationModal'
  });

  // 处理配置变更
  const handleLanguageChange = useCallback((language: ScriptGenerationConfig['language']) => {
    logger.info('用户修改脚本语言设置', { 
      previousLanguage: config.language,
      newLanguage: language,
      timestamp: new Date().toISOString()
    });
    setConfig(prev => ({ ...prev, language }));
  }, [config.language, logger]);

  const handleConsistencyChange = useCallback((consistency: ScriptGenerationConfig['consistency']) => {
    logger.info('用户修改保持程度设置', { 
      previousConsistency: config.consistency,
      newConsistency: consistency,
      timestamp: new Date().toISOString()
    });
    setConfig(prev => ({ ...prev, consistency }));
  }, [config.consistency, logger]);

  const handleSegmentCountChange = useCallback((segmentCount: number) => {
    logger.info('用户修改段落数设置', { 
      previousCount: config.segmentCount,
      newCount: segmentCount,
      timestamp: new Date().toISOString()
    });
    setConfig(prev => ({ ...prev, segmentCount }));
  }, [config.segmentCount, logger]);

  const handleCustomRequirementsChange = useCallback((customRequirements: string) => {
    setConfig(prev => ({ ...prev, customRequirements }));
  }, []);

  // 处理生成脚本
  const handleGenerate = useCallback(() => {
    logger.userAction('确认生成脚本', 'scriptGeneration', {
      config: {
        language: config.language,
        consistency: config.consistency,
        segmentCount: config.segmentCount,
        hasCustomRequirements: !!config.customRequirements?.trim(),
        customRequirementsLength: config.customRequirements?.length || 0
      },
      timestamp: new Date().toISOString()
    });

    onGenerate(config);
  }, [config, onGenerate, logger]);

  // 处理关闭
  const handleClose = useCallback(() => {
    logger.info('用户关闭脚本生成配置弹窗', {
      finalConfig: config,
      timestamp: new Date().toISOString()
    });
    onClose();
  }, [config, onClose, logger]);

  // 计算滑块进度百分比
  const sliderProgress = useMemo(() => {
    return ((config.segmentCount - 1) / 9) * 100;
  }, [config.segmentCount]);

  // 语言选项
  const languageOptions = useMemo(() => [
    { 
      value: 'chinese' as const, 
      label: t.scriptGenerationModal.languageOptions.chinese.label, 
      description: t.scriptGenerationModal.languageOptions.chinese.description 
    },
    { 
      value: 'english' as const, 
      label: t.scriptGenerationModal.languageOptions.english.label, 
      description: t.scriptGenerationModal.languageOptions.english.description 
    },
    { 
      value: 'mixed' as const, 
      label: t.scriptGenerationModal.languageOptions.mixed.label, 
      description: t.scriptGenerationModal.languageOptions.mixed.description 
    }
  ], [t]);

  // 保持程度选项
  const consistencyOptions = useMemo(() => [
    { 
      value: 'high' as const, 
      label: t.scriptGenerationModal.consistencyOptions.high.label, 
      description: t.scriptGenerationModal.consistencyOptions.high.description 
    },
    { 
      value: 'moderate' as const, 
      label: t.scriptGenerationModal.consistencyOptions.moderate.label, 
      description: t.scriptGenerationModal.consistencyOptions.moderate.description 
    },
    { 
      value: 'low' as const, 
      label: t.scriptGenerationModal.consistencyOptions.low.label, 
      description: t.scriptGenerationModal.consistencyOptions.low.description 
    }
  ], [t]);

  if (!isOpen) return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        {/* 头部 */}
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <div className={styles.iconWrapper}>
              <svg className={styles.icon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h2 className={styles.title}>{t.scriptGenerationModal.title}</h2>
          </div>
          <button
            onClick={handleClose}
            className={styles.closeButton}
            aria-label={t.scriptGenerationModal.close}
          >
            <svg className={styles.closeIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 内容区域 */}
        <div className={styles.content}>
          {/* 语言选择 */}
          <div className={styles.section}>
            <label className={styles.sectionLabel}>{t.scriptGenerationModal.languageLabel}</label>
            <div className={styles.optionsGroup}>
              {languageOptions.map((option) => (
                <label key={option.value} className={styles.radioOption}>
                  <input
                    type="radio"
                    name="language"
                    value={option.value}
                    checked={config.language === option.value}
                    onChange={() => handleLanguageChange(option.value)}
                    className={styles.radioInput}
                  />
                  <div className={styles.radioContent}>
                    <div className={styles.radioLabel}>{option.label}</div>
                    <div className={styles.radioDescription}>{option.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* 保持程度 */}
          <div className={styles.section}>
            <label className={styles.sectionLabel}>{t.scriptGenerationModal.consistencyLabel}</label>
            <div className={styles.optionsGroup}>
              {consistencyOptions.map((option) => (
                <label key={option.value} className={styles.radioOption}>
                  <input
                    type="radio"
                    name="consistency"
                    value={option.value}
                    checked={config.consistency === option.value}
                    onChange={() => handleConsistencyChange(option.value)}
                    className={styles.radioInput}
                  />
                  <div className={styles.radioContent}>
                    <div className={styles.radioLabel}>{option.label}</div>
                    <div className={styles.radioDescription}>{option.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* 段落数量 */}
          <div className={styles.sliderSection}>
            <div className={styles.sliderLabel}>
              <span className={styles.sliderLabelText}>{t.scriptGenerationModal.segmentCountLabel}</span>
              <span className={styles.sliderValue}>{config.segmentCount}</span>
            </div>
            <div className={styles.sliderContainer}>
              <span className={styles.sliderMin}>1</span>
              <input
                type="range"
                min="1"
                max="10"
                value={config.segmentCount}
                onChange={(e) => handleSegmentCountChange(parseInt(e.target.value))}
                className={styles.slider}
                style={{ '--slider-progress': `${sliderProgress}%` } as React.CSSProperties}
              />
              <span className={styles.sliderMax}>10</span>
            </div>
            <div className={styles.sliderHint}>
              {t.scriptGenerationModal.segmentCountHint}
            </div>
          </div>

          {/* 自定义要求 */}
          <div className={styles.textareaWrapper}>
            <label className={styles.textareaLabel}>
              {t.scriptGenerationModal.customRequirementsLabel} <span className={styles.optionalTag}>{t.scriptGenerationModal.customRequirementsOptional}</span>
            </label>
            <textarea
              value={config.customRequirements}
              onChange={(e) => handleCustomRequirementsChange(e.target.value)}
              placeholder={t.scriptGenerationModal.customRequirementsPlaceholder}
              className={styles.textarea}
              rows={3}
              maxLength={500}
            />
            <div className={styles.charCount}>
              {t.scriptGenerationModal.charCount
                .replace('{current}', String((config.customRequirements || '').length))
                .replace('{max}', '500')}
            </div>
          </div>
        </div>

        {/* 底部按钮 */}
        <div className={styles.footer}>
          <button
            onClick={handleClose}
            className={styles.cancelButton}
          >
            {t.scriptGenerationModal.cancelButton}
          </button>
          <button
            onClick={handleGenerate}
            className={styles.generateButton}
          >
            <svg className={styles.buttonIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span>{t.scriptGenerationModal.generateButton}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ScriptGenerationModal; 