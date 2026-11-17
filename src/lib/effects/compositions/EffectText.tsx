import React, { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { cancelRender, continueRender, delayRender } from 'remotion';
import { EffectError, type EffectDocument, type EffectTextBox } from '@/types/effects';
import { getEffectFontChain } from '../fontResources';
import { getEffectTextBox, normalizeEffectDisplayText, type EffectTextField } from '../textLayout';
import { fitEffectText, getGraphemes } from './layout';

const layouts = new Map<string, number>();
export const EffectTextResources = createContext('');

/** Actual untransformed DOM bounds decide fit; canvas only suggests a size. */
export function EffectText({ document, field = 'title', text, displayText,
  box: customBox, style, reveal, revealLines, cursor, cursorVisible = true }: {
  document: EffectDocument; field?: EffectTextField | 'params.value';
  text?: string; displayText?: string; box?: EffectTextBox; style?: CSSProperties;
  reveal?: number; revealLines?: boolean; cursor?: boolean; cursorVisible?: boolean;
}) {
  const content = normalizeEffectDisplayText(text ?? document.content[field as EffectTextField] ?? '');
  const resources = useContext(EffectTextResources);
  const box = customBox ?? getEffectTextBox(document, field as EffectTextField);
  const base = Math.min(document.canvas.width, document.canvas.height) * box.sizeRatio * document.typography.scale;
  const family = getEffectFontChain(document.typography.family), weight = field === 'subtitle' ? 400 : 600;
  const key = JSON.stringify([document.templateId, document.canvas, document.params,
    document.typography, content, field, box, cursor, family, resources]);
  const handle = useMemo(() => ({ id: delayRender(`effects text layout (${key.length} characters)`), released: false }), [key]);
  const measurement = useRef<HTMLDivElement>(null);
  const output = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<{ key: string; size: number; error?: Error }>();
  const ready = result?.key === key && !result.error;
  const release = () => {
    if (!handle.released) { handle.released = true; continueRender(handle.id); }
  };
  useLayoutEffect(() => {
    const node = measurement.current;
    try {
      let size = layouts.get(key);
      if (size === undefined && content && node) {
        const fits = (value: number) => {
          node.style.fontSize = `${value}px`;
          node.style.width = `${box.width - (cursor ? value * 0.2 : 0)}px`;
          return node.scrollWidth <= node.clientWidth + 1
            && node.scrollHeight <= box.height + 1;
        };
        const minimum = base * box.minScale;
        if (!fits(minimum)) throw new EffectError('EFFECT_TEXT_OVERFLOW');
        let low = minimum, high = base;
        const candidate = Number(fitEffectText({ document, text: content,
          subtitle: field === 'subtitle', width: box.width, height: box.height }).fontSize);
        if (fits(base)) low = base;
        else {
          if (candidate > low && candidate < high) {
            if (fits(candidate)) low = candidate; else high = candidate;
          }
          for (let i = 0; i < 12; i++) {
            const middle = (low + high) / 2;
            if (fits(middle)) low = middle; else high = middle;
          }
        }
        size = low;
        if (layouts.size >= 512) layouts.clear();
        layouts.set(key, size);
      }
      setResult({ key, size: size ?? base });
    } catch {
      const error = new EffectError('EFFECT_TEXT_OVERFLOW');
      setResult({ key, size: base, error }); cancelRender(error); release();
    }
    return release;
    // Frame/reveal changes reuse full-text layout; the key contains every layout input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, handle]);
  useLayoutEffect(() => {
    if (!ready) return;
    try {
      const group = output.current?.closest<HTMLElement>('[data-effects-text-group]');
      if (group && !group.querySelector('[data-effects-layout-ready="false"]')) {
        const occupied = Array.from(group.children).filter(child => !child.hasAttribute('data-effects-measure')).reduce((sum, child) => {
          const element = child as HTMLElement, css = getComputedStyle(element);
          return sum + element.offsetHeight + parseFloat(css.marginTop || '0') + parseFloat(css.marginBottom || '0');
        }, 0);
        if (occupied > Number(group.dataset.effectsGroupHeight) + 1)
          throw new EffectError('EFFECT_TEXT_OVERFLOW');
      }
      release();
    } catch {
      const error = new EffectError('EFFECT_TEXT_OVERFLOW');
      setResult({ key, size: base, error }); cancelRender(error); release();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key, handle]);
  if (result?.key === key && result.error) throw result.error;
  if (!content) return null;
  const size = ready ? result!.size : base;
  const lines = content.split('\n');
  const displayedLines = displayText === undefined ? undefined
    : normalizeEffectDisplayText(displayText).split('\n');
  const all = getGraphemes(content), count = Math.ceil(all.length * (reveal ?? 1));
  let offset = 0;
  const renderLines = (measuring: boolean) => lines.map((line, index) => {
    const letters = getGraphemes(line), start = offset;
    offset += letters.length + 1;
    return <div key={index} data-effects-line style={{ minHeight: '1.3em',
      opacity: !measuring && revealLines && index >= Math.ceil(lines.length * (reveal ?? 1)) ? 0 : 1 }}>
      {!measuring && cursor && !revealLines && count === start && <span aria-hidden data-effects-cursor style={{
        display: 'inline-block', position: 'relative', width: 0, height: '1em', opacity: cursorVisible ? 1 : 0 }}>
        <span style={{ position: 'absolute', left: 0, top: 0, width: '0.1em', height: '1em', background: document.palette.accent }} />
      </span>}
      {reveal === undefined || revealLines ? (measuring ? line : displayedLines?.[index] ?? line)
        : letters.map((letter, i) => <span key={i} style={{ position: 'relative',
          visibility: measuring || start + i < count ? 'visible' : 'hidden' }}>{letter}
          {!measuring && cursor && start + i === count - 1 && <span aria-hidden data-effects-cursor style={{
            position: 'absolute', right: '-0.12em', top: 0, width: '0.1em', height: '1em',
            opacity: cursorVisible ? 1 : 0, background: document.palette.accent }} />}
        </span>)}
    </div>;
  });
  const common: CSSProperties = { width: box.width - (cursor ? size * 0.2 : 0),
    fontSize: size, fontFamily: family, fontWeight: weight, lineHeight: box.lineHeight,
    fontVariantNumeric: style?.fontVariantNumeric,
    whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', textAlign: document.typography.align,
    padding: 0, border: 0, boxSizing: 'content-box', flexShrink: 0 };
  offset = 0;
  const measured = renderLines(true); offset = 0;
  return <>
    <div ref={measurement} data-effects-measure aria-hidden style={{ ...common,
      position: 'absolute', visibility: 'hidden', pointerEvents: 'none', margin: 0 }}>{measured}</div>
    <div ref={output} data-effects-text={field} data-effects-layout-ready={String(!!ready)}
      style={{ ...style, ...common, visibility: ready ? 'visible' : 'hidden' }}>{renderLines(false)}</div>
  </>;
}
