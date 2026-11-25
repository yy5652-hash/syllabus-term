// Structured output that both the on-device and the cloud model must return.
// The same JSON Schema is passed as Chrome's `responseConstraint` (on device)
// and as Gemini's `responseSchema` (cloud), so both paths are checked identically.

export type ComponentKind = 'exam' | 'quiz' | 'assignment' | 'project' | 'participation' | 'other';
export type DateKind = 'exam' | 'quiz' | 'deadline' | 'other';

export interface GradingComponent {
  name: string;
  weight: number; // percent, 0–100
  kind: ComponentKind;
  bonus?: boolean;
  points?: number;
}

export interface GradingResult {
  components: GradingComponent[];
  totalPoints?: number;
}

export interface DatedItem {
  label: string;
  date: string; // YYYY-MM-DD
  kind: DateKind;
}

export interface ScheduleResult {
  items: DatedItem[];
}

export const GRADING_SCHEMA = {
  type: 'object',
  properties: {
    totalPoints: { type: 'number' },
    components: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          points: { type: 'number' },
          weight: { type: 'number' },
          bonus: { type: 'boolean', description: 'true for extra credit that is added on top of 100%' },
          kind: { type: 'string', enum: ['exam', 'quiz', 'assignment', 'project', 'participation', 'other'] },
        },
        required: ['name', 'weight', 'kind'],
      },
    },
  },
  required: ['components'],
} as const;

export const POINTS_SCHEMA = {
  ...GRADING_SCHEMA,
  properties: {
    ...GRADING_SCHEMA.properties,
    components: {
      ...GRADING_SCHEMA.properties.components,
      items: { ...GRADING_SCHEMA.properties.components.items, required: ['name', 'points', 'kind'] },
    },
  },
} as const;

export const SCHEDULE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          kind: { type: 'string', enum: ['exam', 'quiz', 'deadline', 'other'] },
        },
        required: ['label', 'date', 'kind'],
      },
    },
  },
  required: ['items'],
} as const;
