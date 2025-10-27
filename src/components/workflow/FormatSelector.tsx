'use client';

import React from 'react';
import { DataFormat } from '@/types';

export interface FormatSelectorProps {
  /** Label for the selector */
  label: string;
  /** Current selected format */
  value: DataFormat;
  /** Callback when format changes */
  onChange: (format: DataFormat) => void;
  /** Whether to show input or output icon */
  type?: 'input' | 'output';
  /** Optional help text */
  helpText?: string;
  /** Disabled state */
  disabled?: boolean;
}

/**
 * Format icons mapping
 */
const FormatIcons: Record<DataFormat, React.ReactNode> = {
  'text/plain': (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  'application/json': (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  'array': (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
    </svg>
  ),
};

/**
 * Format display names
 */
const FormatDisplayNames: Record<DataFormat, string> = {
  'text/plain': 'Plain Text',
  'application/json': 'JSON Object',
  'array': 'Array',
};

/**
 * Format descriptions
 */
const FormatDescriptions: Record<DataFormat, string> = {
  'text/plain': 'Simple text string',
  'application/json': 'JSON object with key-value pairs',
  'array': 'Array of items',
};

/**
 * Format Selector Component
 * 
 * A clean, Apple-style dropdown for selecting data formats
 * Used in workflow node configuration panels
 */
const FormatSelector: React.FC<FormatSelectorProps> = ({
  label,
  value,
  onChange,
  type = 'input',
  helpText,
  disabled = false,
}) => {
  const formats: DataFormat[] = ['text/plain', 'application/json', 'array'];

  const typeIcon = type === 'input' ? (
    <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16l-4-4m0 0l4-4m-4 4h18" />
    </svg>
  ) : (
    <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
    </svg>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="flex items-center space-x-2 text-sm font-medium text-gray-900">
          {typeIcon}
          <span>{label}</span>
        </label>
        {helpText && (
          <div className="group relative">
            <svg className="w-4 h-4 text-gray-400 hover:text-gray-600 cursor-help" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="absolute right-0 bottom-full mb-2 hidden group-hover:block w-64 p-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg z-10">
              {helpText}
            </div>
          </div>
        )}
      </div>

      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as DataFormat)}
          disabled={disabled}
          className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-400/50 focus:border-gray-400 transition-all text-sm text-gray-900 appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed pr-10"
        >
          {formats.map((format) => (
            <option key={format} value={format}>
              {FormatDisplayNames[format]}
            </option>
          ))}
        </select>
        
        {/* Custom dropdown arrow */}
        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Current selection display with icon */}
      <div className="flex items-center space-x-2 px-3 py-2 bg-gray-50 border border-gray-100 rounded-lg">
        <div className="text-gray-600">
          {FormatIcons[value]}
        </div>
        <div className="flex-1">
          <div className="text-xs font-medium text-gray-900">
            {FormatDisplayNames[value]}
          </div>
          <div className="text-xs text-gray-500">
            {FormatDescriptions[value]}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FormatSelector;

