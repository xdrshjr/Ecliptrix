'use client';

import React, { useEffect, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { findCredentialLink, safeExternalUrl } from '@/lib/credentialLinks';
import { TEXT_LINK } from '@/components/Onboarding/wizard/wizardStyles';

/** How long "Copied" stays before the button offers copying again. */
const COPIED_FEEDBACK_MS = 2000;

interface GetCredentialLinkProps {
  /** A `credentialLinks` registry id (integration or model provider). */
  id: string;
  /** Overrides the default "Get a key" wording (e.g. "Get a Tavily key"). */
  label?: string;
  /** Also show the docs link (default true). */
  showDocs?: boolean;
  /** Also show the extra activation step, e.g. enabling ARK models. */
  showActivation?: boolean;
  className?: string;
}

interface ExternalLinkProps {
  url: string;
  label: string;
  suffix: string;
}

/** Every outbound link carries target=_blank, or the app window itself navigates. */
const ExternalLink: React.FC<ExternalLinkProps> = ({ url, label, suffix }) => (
  <a
    href={url}
    target="_blank"
    rel="noopener noreferrer"
    aria-label={`${label} ${suffix}`}
    className={TEXT_LINK}
  >
    {label} ↗
  </a>
);

/**
 * The ONLY place a credential link is rendered. It takes a registry id, never
 * a URL, so no backend or user input can reach the shell's `openExternal`.
 * An id without a safe link degrades to a plain sentence instead of an anchor.
 */
const GetCredentialLink: React.FC<GetCredentialLinkProps> = ({
  id,
  label,
  showDocs = true,
  showActivation = true,
  className = '',
}) => {
  const copy = useLocale().t.integrations.link;
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  const entry = findCredentialLink(id);
  const consoleUrl = entry ? safeExternalUrl(entry.consoleUrl) : null;

  if (!entry || !consoleUrl) {
    return <p className={`text-xs text-muted-foreground ${className}`}>{copy.noLink}</p>;
  }

  const docsUrl = showDocs && entry.docsUrl ? safeExternalUrl(entry.docsUrl) : null;
  const activationUrl =
    showActivation && entry.activationUrl ? safeExternalUrl(entry.activationUrl) : null;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(consoleUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <span className={`inline-flex flex-wrap items-center gap-x-4 gap-y-1 ${className}`}>
      <ExternalLink url={consoleUrl} label={label ?? copy.getKey} suffix={copy.external} />
      {activationUrl && (
        <ExternalLink url={activationUrl} label={copy.activate} suffix={copy.external} />
      )}
      {docsUrl && <ExternalLink url={docsUrl} label={copy.docs} suffix={copy.external} />}
      <button
        type="button"
        onClick={() => void copyLink()}
        aria-live="polite"
        className={`${TEXT_LINK} text-muted-foreground`}
      >
        {copied ? copy.copied : copy.copy}
      </button>
    </span>
  );
};

export default GetCredentialLink;
