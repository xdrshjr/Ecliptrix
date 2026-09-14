/**
 * A `framer-motion` stand-in for compiled timeline chat components: every
 * `motion.<tag>` renders the plain element without the animation-only props,
 * and `AnimatePresence` renders its children.
 */
import * as React from 'react';

const MOTION_ONLY_PROPS = ['variants', 'initial', 'animate', 'exit', 'layout', 'transition'];
const motionComponents = new Map<string, React.ElementType>();

function motionComponent(tag: string): React.ElementType {
  const cached = motionComponents.get(tag);
  if (cached) return cached;
  const component = React.forwardRef<Element, Record<string, unknown>>(function MotionStub(props, ref) {
    const domProps: Record<string, unknown> = { ...props, ref };
    for (const key of MOTION_ONLY_PROPS) delete domProps[key];
    return React.createElement(tag, domProps);
  });
  component.displayName = `motion.${tag}`;
  motionComponents.set(tag, component);
  return component;
}

export function framerMotionModule(): Record<string, unknown> {
  return {
    'framer-motion': {
      motion: new Proxy({}, { get: (_target, tag: string) => motionComponent(tag) }),
      AnimatePresence: ({ children }: { children?: React.ReactNode }) =>
        React.createElement(React.Fragment, null, children),
    },
  };
}
