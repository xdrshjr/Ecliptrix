import React from 'react';

interface StepHeadingProps {
  title: string;
  description?: string;
}

/** Shared heading; its ids are what the wizard Modal's aria props point at. */
const StepHeading: React.FC<StepHeadingProps> = ({ title, description }) => (
  <div>
    <h2 id="setup-wizard-title" className="text-xl font-semibold text-foreground">
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

export default StepHeading;
