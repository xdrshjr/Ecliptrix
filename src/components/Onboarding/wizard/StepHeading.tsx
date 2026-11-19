'use client';

import React, { useEffect, useRef } from 'react';

interface StepHeadingProps {
  title: string;
  description?: string;
  /**
   * Move keyboard focus to the title when the step mounts, so a screen reader
   * announces the new step instead of staying on the button that was pressed.
   * Steps that autofocus a field of their own leave this off.
   */
  focusOnMount?: boolean;
}

/** Shared heading; its ids are what the wizard Modal's aria props point at. */
const StepHeading: React.FC<StepHeadingProps> = ({ title, description, focusOnMount = false }) => {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusOnMount) headingRef.current?.focus({ preventScroll: true });
  }, [focusOnMount]);

  return (
    <div>
      <h2
        ref={headingRef}
        id="setup-wizard-title"
        tabIndex={focusOnMount ? -1 : undefined}
        className="text-xl font-semibold text-foreground focus:outline-none"
      >
        {title}
      </h2>
      {description && (
        <p
          id="setup-wizard-desc"
          className="mt-2 text-sm leading-relaxed text-muted-foreground"
        >
          {description}
        </p>
      )}
    </div>
  );
};

export default StepHeading;
