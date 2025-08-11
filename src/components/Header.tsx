'use client';

import React from 'react';

const Header: React.FC = () => {
  return (
    <header className="h-14 bg-white/80 backdrop-blur-md border-b border-gray-200 sticky top-0 z-50">
      <div className="h-full px-6 flex items-center justify-between">
        {/* Logo and Brand */}
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
            <div className="w-4 h-4 bg-white rounded-sm opacity-90"></div>
          </div>
          <div className="flex flex-col">
            <h1 className="text-lg font-semibold text-gray-900 leading-none">
              Ecliptrix
            </h1>
            <p className="text-xs text-gray-500 leading-none">
              Where light and shadow collide
            </p>
          </div>
        </div>

        {/* Navigation - 暂时隐藏默认导航项 */}
        {/* 
        <nav className="hidden md:flex items-center space-x-8">
          <button className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors">
            Dashboard
          </button>
          <button className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors">
            Projects
          </button>
          <button className="text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors">
            Library
          </button>
        </nav>
        */}

        {/* User Actions */}
        <div className="flex items-center space-x-3">
          <button className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors">
            <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-5 5v-5z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7H4l5-5v5z" />
            </svg>
          </button>
          <button className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors">
            <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <span className="text-xs font-medium text-white">U</span>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header; 