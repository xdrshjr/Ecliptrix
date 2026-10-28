const FOCUS_RING =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';
const MOTION = 'transition-colors motion-reduce:transition-none';

export const BUTTON_PRIMARY = `inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 ${MOTION} ${FOCUS_RING}`;

export const BUTTON_GHOST = `inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60 ${MOTION} ${FOCUS_RING}`;

export const TEXT_LINK = `rounded text-sm font-medium text-primary underline-offset-4 hover:underline ${FOCUS_RING}`;

export const FIELD_INPUT =
  'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';

export const ERROR_TEXT = 'mt-2 text-sm text-destructive';
