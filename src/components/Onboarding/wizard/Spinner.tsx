import React from 'react';

/** Small inline spinner; static under prefers-reduced-motion. */
const Spinner: React.FC = () => (
  <span
    aria-hidden="true"
    className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
  />
);

export default Spinner;
