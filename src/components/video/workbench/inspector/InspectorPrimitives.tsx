'use client';

/**
 * Layout primitives of the properties page: label/value rows grouped into
 * sections separated by spacing (no borders, spec §3.10).
 */

import React from 'react';
import { Lock } from './icons';

export interface InspectorSectionProps {
  title?: React.ReactNode;
  children: React.ReactNode;
}

export function InspectorSection({ title, children }: InspectorSectionProps) {
  return (
    <section className="ws-inspector-section">
      {title ? <h3 className="ws-inspector-heading">{title}</h3> : null}
      {children}
    </section>
  );
}

export interface InspectorRowProps {
  label: string;
  children: React.ReactNode;
  /** Times and numbers align on tabular figures. */
  tabular?: boolean;
}

export function InspectorRow({ label, children, tabular = false }: InspectorRowProps) {
  return (
    <div className="ws-inspector-row">
      <dt className="ws-inspector-label">{label}</dt>
      <dd className={tabular ? 'ws-inspector-value ws-tabular' : 'ws-inspector-value'}>
        {children}
      </dd>
    </div>
  );
}

export function InspectorRows({ children }: { children: React.ReactNode }) {
  return <dl className="ws-inspector-rows">{children}</dl>;
}

export function InspectorActions({ children }: { children: React.ReactNode }) {
  return <div className="ws-inspector-actions">{children}</div>;
}

/** Shown above the controls while the agent holds the timeline edit lock. */
export function EditLockNotice({ message }: { message: string }) {
  return (
    <p className="ws-inspector-lock" role="status">
      <Lock size={16} strokeWidth={1.75} aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}
