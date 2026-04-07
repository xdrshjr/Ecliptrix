# Execution Summary: TODO 03 — Frontend Tab Layout Restructure & Provider Management

## Meta

| Field | Value |
|-------|-------|
| Task ID | TODO 03 |
| Spec | `specs/03-frontend-tab-layout.md` |
| Agent | dev-02 (Google SWE) |
| Status | Completed |
| Date | 2026-04-07 |
| TypeScript Errors | 0 (pre-existing 16 errors in unrelated test file) |

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Hand-rolled tab UI using border-bottom indicator | Project has no shadcn Tabs component; consistent with existing custom UI style |
| `urlManuallyEdited` / `formatManuallyEdited` default to `true` when editing existing providers | Prevents auto-fill from overwriting user's saved URL/format on type change |
| `coding` temperature defaults to 1.0 | Per spec requirement, coding differs from other types which use 0.7 |
| Coding provider badge uses blue coloring | Distinct visual differentiation per spec; uses Tailwind blue palette with dark mode support |
| Default models displayed as rounded chips/tags | Consistent with spec design; no fetch API called for coding-type providers |
| `WifiIcon` added for card-level test connection | Each provider card now has inline test button (wifi icon) |
| Tab 2 (assignments) preserves full existing assignment JSX | All 5 function types render including coding; ready for dev-03 enhancement |
| Tab 3 (advanced) has functional placeholder | Shows effective config overview with source indicators per function type |

## Execution Flow

1. Added 18 new i18n type definitions, English translations, and Chinese translations to `src/lib/i18n.ts`
2. Extended `FunctionType` to include `'coding'` (5 types total)
3. Extended `FUNCTION_TYPES` array to `['chat', 'fast', 'video_cut', 'vision', 'coding']`
4. Extended `KnownProvider` interface: added `api_format` and `default_models`
5. Extended `SavedProvider` interface: added `api_format`
6. Extended `ProviderFormState` interface: added `api_format`, `urlManuallyEdited`, `formatManuallyEdited`
7. Extended `TestResult` interface: added `model_info` with `model` and `format_used`
8. Added `TabType = 'providers' | 'assignments' | 'advanced'` and `activeTab` state
9. Initialized `assignments` state with `coding: null`
10. Initialized `assignmentForms` state with `coding` entry (temperature 1.0)
11. Updated `fetchData` to parse `api_format` and `default_models` from backend responses
12. Updated `handleProviderTypeSelect` for smart auto-fill (respects manually-edited flags)
13. Updated `handleSaveProvider` to include `api_format` in create/update payloads
14. Updated `handleTestProviderConnection` to pass `api_format` and `provider_type`, use `default_models[0]` for test model
15. Refactored render into three tab render functions: `renderProvidersTab`, `renderAssignmentsTab`, `renderAdvancedTab`
16. Provider cards now show: name, type badge (blue for coding), API format badge, truncated URL, key status, default model tags
17. Provider form now includes API Format dropdown (Auto/OpenAI/Anthropic)
18. Coding-type providers show default_models as tags instead of fetch button
19. Connection test result shows `model_info` (model name + format used) when available
20. Tab navigation bar with active indicator at top of panel

## Artifacts

| File | Change Type | Lines (approx) |
|------|-------------|-----------------|
| `src/components/AdminSettings/ModelSettingsPanel.tsx` | Rewritten | ~690 |
| `src/lib/i18n.ts` | Modified (3 locations) | +54 lines |
| `docs/plans/coding-plan-model-settings/summaries/phase-3/dev--google-dev-02--todo-03.md` | Created | This file |

## Interfaces Touched

### Types exported/used by downstream

```typescript
type FunctionType = 'chat' | 'fast' | 'video_cut' | 'vision' | 'coding';
const FUNCTION_TYPES: FunctionType[] = ['chat', 'fast', 'video_cut', 'vision', 'coding'];

// States available for Tab 2/3 usage:
// - assignments: Record<FunctionType, Assignment | null>  (includes coding: null)
// - assignmentForms: Record<FunctionType, AssignmentFormState>  (includes coding with temp 1.0)
// - savedProviders: ProviderWithModels[]  (includes api_format field)
// - knownProviders: KnownProvider[]  (includes api_format and default_models)
// - functionTypeLabels: Record<FunctionType, string>  (includes coding label)
```

### i18n keys added

`tabProviders`, `tabAssignments`, `tabAdvanced`, `apiFormat`, `apiFormatAuto`, `apiFormatOpenai`, `apiFormatAnthropic`, `defaultModels`, `effectiveConfig`, `configSource`, `configFromDb`, `configFromEnv`, `envFallbackDesc`, `testConnectionFormat`, `modelInfo`, `formatUsed`, `providerCard`

### Backend API contracts consumed

- `GET /api/model-settings/providers` — now reads `api_format` and `default_models` from response
- `POST/PUT /api/model-settings/providers` — now sends `api_format` in payload
- `POST /api/model-settings/test-connection` — now sends `api_format` and `provider_type` in payload
- `GET /api/model-settings/providers/saved` — now reads `api_format` from each provider

## Issues & Risks

| Issue | Severity | Notes |
|-------|----------|-------|
| Tab 2 assignment JSX is a full copy of original Section 2 | Low | dev-03 (TODO 04) will enhance/replace this content. Intentionally left as working placeholder. |
| Tab 3 advanced section is minimal | Low | Placeholder with effective config overview. dev-03 will add full content. |
| `CODING_PROVIDER_TYPES` array duplicated from CodingPlanPanel | Low | TODO 05 will delete CodingPlanPanel; no conflict since they're in separate files |

## Context for Downstream

### For dev-03 (TODO 04 — Model Assignment Tab)

- The `FunctionType` union and `FUNCTION_TYPES` array now include `'coding'`
- `assignments` state is pre-initialized with `coding: null`
- `assignmentForms` state is pre-initialized with `coding` entry (temperature 1.0)
- `functionTypeLabels` maps all 5 types to i18n strings
- The `renderAssignmentsTab()` function contains working assignment UI for all 5 types; dev-03 should enhance this in-place
- `KnownProvider.default_models` is available for showing preset model options in assignment dropdowns
- All data is shared across tabs; no re-fetch on tab switch

### For dev-02 (TODO 05 — Cleanup)

- `CodingPlanPanel.tsx` is NOT deleted yet; that's TODO 05's job
- Sidebar menu item for coding plan still exists; TODO 05 removes it
- `codingPlan*` i18n keys still exist; TODO 05 cleans them up
- New i18n keys are already added; TODO 05 only needs to remove deprecated keys
