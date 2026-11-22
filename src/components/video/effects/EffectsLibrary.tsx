import React, { useEffect, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { EFFECT_CATALOG } from '@/lib/effects/catalog';

export function EffectsLibrary(options: {
  selected: string; onSelect: (id: string) => void;
}) {
  const { t } = useLocale();
  const [library, setLibrary] = useState('titles');
  const [active, setActive] = useState<string>();
  useEffect(() => {
    const selected = EFFECT_CATALOG.templates.find(item => item.id === options.selected);
    if (selected) setLibrary(selected.libraryId);
  }, [options.selected]);
  const reduced = typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return <section className="h-full overflow-y-auto p-3 space-y-3"
    aria-label={t.effects.labels.templates}>
    <label className="block text-xs text-muted-foreground">
      {t.effects.labels.templates}
      <select className="mt-2 w-full rounded border border-border bg-background p-2"
        value={library} onChange={event => setLibrary(event.target.value)}>
        {EFFECT_CATALOG.libraries.map(item => <option key={item.id} value={item.id}>
          {t.effects.libraries[item.id]}</option>)}
      </select>
    </label>
    {EFFECT_CATALOG.templates.filter(item => item.libraryId === library)
      .map(template => <button key={template.id} type="button"
        aria-pressed={options.selected === template.id}
        onClick={() => options.onSelect(template.id)}
        onPointerEnter={() => setActive(template.id)}
        onFocus={() => setActive(template.id)} onBlur={() => setActive(undefined)}
        onPointerLeave={() => setActive(undefined)}
        className={`block w-full overflow-hidden rounded-lg border text-left
          focus-visible:ring-2 focus-visible:ring-ring ${options.selected === template.id
        ? 'border-primary bg-primary/5' : 'border-border bg-background hover:bg-muted'}`}>
        {active === template.id && !reduced
          ? <video src={template.demoPreview} poster={template.thumbnail}
            autoPlay muted loop playsInline className="pointer-events-none aspect-video w-full object-cover" />
          : <img src={template.thumbnail} alt="" className="pointer-events-none aspect-video w-full object-cover" />}
        <span className="block px-3 py-2 text-sm">{t.effects.templates[template.id]}</span>
      </button>)}
    <p className="text-xs leading-relaxed text-muted-foreground">
      {t.effects.labels.sourceSpace}
    </p>
  </section>;
}
