'use client';

/**
 * BrowserStartPage — what a blank tab shows (spec §4.6.3). The native view is
 * hidden for a blank tab, so this is plain DOM and (being in flow, never over a
 * live view) carries `data-native-inflow`.
 *
 * Quick sites come from the static registry only; the scene cards merely FILL the
 * chat box with a prompt — nothing is sent automatically.
 */

import React, { useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { BROWSER_SITES, isAllowedBrowserSite } from '@/lib/browserSites';
import { sendPrefilledMessage } from '@/lib/video-editing-agent/prefilledMessage';
import { resolveOmnibox, type SearchEngine } from './omnibox';
import { Compass, Globe, Image as ImageIcon, Search } from './browserIcons';

export interface BrowserStartPageProps {
  searchEngine: SearchEngine;
  onNavigate(url: string): void;
}

export default function BrowserStartPage({ searchEngine, onNavigate }: BrowserStartPageProps) {
  const { t } = useLocale();
  const copy = t.browserWorkspace.start;
  const [query, setQuery] = useState('');
  const scenes = [
    { id: 'news', label: copy.sceneNews, draft: copy.sceneNewsDraft, icon: <Globe size={16} /> },
    { id: 'source', label: copy.sceneSource, draft: copy.sceneSourceDraft, icon: <Compass size={16} /> },
    { id: 'image', label: copy.sceneImage, draft: copy.sceneImageDraft, icon: <ImageIcon size={16} /> },
  ];

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const target = resolveOmnibox(query, searchEngine);
    if (target) onNavigate(target.url);
  };

  return (
    <div className="bw-start" data-native-inflow="true">
      <h2 className="bw-start-title">{copy.title}</h2>
      <form className="bw-start-search" onSubmit={submit}>
        <Search size={15} />
        <input className="bw-start-input" type="text" value={query} spellCheck={false}
          placeholder={copy.searchPlaceholder} aria-label={copy.searchPlaceholder}
          onChange={(event) => setQuery(event.target.value)} />
      </form>
      <section aria-label={copy.sitesTitle}>
        <p className="bw-start-caption">{copy.sitesTitle}</p>
        <ul className="bw-site-grid">
          {BROWSER_SITES.filter((site) => isAllowedBrowserSite(site.url)).map((site) => (
            <li key={site.id}>
              <button type="button" className="bw-site-card" onClick={() => onNavigate(site.url)}>
                <span className="bw-site-letter" aria-hidden="true">{site.name.slice(0, 1)}</span>
                <span className="bw-site-name">{site.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label={copy.scenesTitle}>
        <p className="bw-start-caption">{copy.scenesTitle}</p>
        <div className="bw-scene-row">
          {scenes.map((scene) => (
            <button key={scene.id} type="button" className="bw-scene-card"
              onClick={() => sendPrefilledMessage(scene.draft)}>
              {scene.icon}<span>{scene.label}</span>
            </button>
          ))}
        </div>
        <p className="bw-start-hint">{copy.sceneHint}</p>
      </section>
    </div>
  );
}
