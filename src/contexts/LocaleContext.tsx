'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { SupportedLocale, defaultLocale, getTranslations, type Translations } from '@/lib/i18n';

interface LocaleContextType {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  t: Translations;
}

const LocaleContext = createContext<LocaleContextType | undefined>(undefined);

interface LocaleProviderProps {
  children: React.ReactNode;
}

export const LocaleProvider: React.FC<LocaleProviderProps> = ({ children }) => {
  const [locale, setLocaleState] = useState<SupportedLocale>(defaultLocale);
  const [translations, setTranslations] = useState<Translations>(getTranslations(defaultLocale));

  // Load locale from localStorage on mount
  useEffect(() => {
    const savedLocale = localStorage.getItem('ecliptrix-locale') as SupportedLocale;
    if (savedLocale && (savedLocale === 'en' || savedLocale === 'zh-CN')) {
      setLocaleState(savedLocale);
      setTranslations(getTranslations(savedLocale));
    }
  }, []);

  const setLocale = (newLocale: SupportedLocale) => {
    setLocaleState(newLocale);
    setTranslations(getTranslations(newLocale));
    localStorage.setItem('ecliptrix-locale', newLocale);
    
    // Update document language attribute
    document.documentElement.lang = newLocale === 'zh-CN' ? 'zh-CN' : 'en';
  };

  const value: LocaleContextType = {
    locale,
    setLocale,
    t: translations,
  };

  return (
    <LocaleContext.Provider value={value}>
      {children}
    </LocaleContext.Provider>
  );
};

export const useLocale = (): LocaleContextType => {
  const context = useContext(LocaleContext);
  if (context === undefined) {
    throw new Error('useLocale must be used within a LocaleProvider');
  }
  return context;
}; 