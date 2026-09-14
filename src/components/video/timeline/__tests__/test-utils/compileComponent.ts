/**
 * Shared loader for rendering real `.tsx` components under Vitest.
 *
 * tsconfig keeps JSX as `preserve`, which Vitest's esbuild honours, so a
 * component cannot be imported directly (and `fs` is externalised under
 * jsdom). Tests import the raw source with `?raw`, compile it here with the
 * TypeScript API and hand every runtime import an explicit module — an import
 * the test did not map fails loudly instead of silently loading the real thing.
 * This is the pattern of `ConfirmationDialog.focus.test.tsx`, factored out so
 * the timeline suites stop copying it.
 */
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import * as ReactDOM from 'react-dom';
import ts from 'typescript';
import { getTranslations, type SupportedLocale } from '@/lib/i18n';

export type ModuleMap = Record<string, unknown>;

/** React, the automatic JSX runtime and react-dom (portals). */
export function reactModules(): ModuleMap {
  return {
    react: React,
    'react/jsx-runtime': jsxRuntime,
    'react-dom': ReactDOM,
  };
}

/** A `@/contexts/LocaleContext` stand-in serving the real translation table. */
export function localeContextModule(getLocale: () => SupportedLocale = () => 'en'): ModuleMap {
  return {
    '@/contexts/LocaleContext': {
      useLocale: () => {
        const locale = getLocale();
        return { locale, setLocale: () => {}, t: getTranslations(locale) };
      },
    },
  };
}

/** Compile `source` and evaluate it against `modules`; returns its exports. */
export function compileComponentModule(source: string, modules: ModuleMap): Record<string, unknown> {
  const { outputText } = ts.transpileModule(String(source), {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  const compiled = { exports: {} as Record<string, unknown> };
  const requireModule = (id: string) => {
    if (id in modules) return modules[id];
    throw new Error(`unmapped import ${id}`);
  };
  new Function('require', 'module', 'exports', outputText)(requireModule, compiled, compiled.exports);
  return compiled.exports;
}

/** Default export of a compiled component module. */
export function compileComponent<P>(source: string, modules: ModuleMap): React.FC<P> {
  const exports = compileComponentModule(source, modules);
  const component = exports.default;
  if (typeof component !== 'function') {
    throw new Error('compiled module has no default component export');
  }
  return component as React.FC<P>;
}

/**
 * jsdom has no ResizeObserver; timeline containers observe their own size on
 * mount. Returns a restore function for `afterEach`.
 */
export function installResizeObserverStub(): () => void {
  const globalScope = globalThis as { ResizeObserver?: unknown };
  const previous = globalScope.ResizeObserver;
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalScope.ResizeObserver = ResizeObserverStub;
  return () => {
    globalScope.ResizeObserver = previous;
  };
}
