import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  AI_CUSTOM_FONT_MAX_PX,
  AI_CUSTOM_FONT_MIN_PX,
  DEFAULT_AI_PANEL_PREFS,
  Dropdown,
  aiPanelFontPx,
  clampAiCustomFontSize,
} from '@genoffice/ui'
import type { AiFontSize, AiPanelPrefs, AiPanelSide } from '@genoffice/ui'
import type { DefaultAppStatus, FileSearchSettings, JevEndpoint } from '../../shared/home-api'
import type { UpdateUiState } from '../../shared/update-api'
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  MAX_MAX_OUTPUT_TOKENS,
  MIN_MAX_OUTPUT_TOKENS,
  clampMaxOutputTokens,
} from '@genoffice/ai-provider/browser'
import type {
  AiMediaProviderId,
  AiMediaProviderMeta,
  AiMediaSettings,
  AiSearchProviderMeta,
  AiSearchSettings,
  AiSettings,
} from '@genoffice/ai-provider'
import { formatList, useI18n } from './locale'
import type { StringKey, TFunc } from './locale'
import type {
  AiCatalogEntry,
  DocTheme,
  FaamAccountEvent,
  FaamAccountInfo,
  UiTheme,
} from '../../shared/home-api'
import { LANG_OPTIONS } from '../../shared/languages'
import { ProviderLogo } from './provider-logos'
import { IntegrationsPane, skillUpdateDue } from './IntegrationsPane'
import './settings.css'

// ── Settings modal (opened from the account menu) ─────────
// Two-pane dialog: section nav on the left, fields on the right.
// All values go through the existing home IPC; nothing is stored locally.

// GenMail's option order: follow-system first, then the manual picks
const THEME_OPTIONS = [
  { value: 'system', labelKey: 'themeSystem' },
  { value: 'light', labelKey: 'themeLight' },
  { value: 'dark', labelKey: 'themeDark' },
] as const satisfies readonly { value: UiTheme; labelKey: StringKey }[]

// Document page theme (#1811): the canvas/paper preference the editors follow;
// 'follow' keeps the pre-existing behavior of riding the UI theme
const DOC_THEME_OPTIONS = [
  { value: 'follow', labelKey: 'docThemeFollowApp' },
  { value: 'light', labelKey: 'themeLight' },
  { value: 'dark', labelKey: 'themeDark' },
] as const satisfies readonly { value: DocTheme; labelKey: StringKey }[]

const AI_FONT_SIZE_OPTIONS = [
  { value: 'default', labelKey: 'aiFontSizeDefault' },
  { value: 'large', labelKey: 'aiFontSizeLarge' },
  { value: 'xlarge', labelKey: 'aiFontSizeXLarge' },
  { value: 'custom', labelKey: 'aiFontSizeCustom' },
] as const satisfies readonly { value: AiFontSize; labelKey: StringKey }[]

const CHANNEL_OPTIONS = [
  { value: 'stable', labelKey: 'channelStable' },
  { value: 'beta', labelKey: 'channelBeta' },
] as const satisfies readonly { value: 'stable' | 'beta'; labelKey: StringKey }[]

/** GitHub-style abbreviated stargazer count (2591 → "2.6k") — the number is
 * social proof, not a metric; the cached/exact value would only look stale */
function formatStars(n: number): string {
  if (n < 1000) return String(n)
  const k = n / 1000
  return `${k >= 100 ? Math.round(k) : (Math.round(k * 10) / 10).toString().replace(/\.0$/, '')}k`
}

/** px stepper for the custom AI panel text size; in-range values apply live,
 * out-of-range or partial input is clamped on blur */
function CustomFontSizeInput({
  value,
  label,
  onCommit,
}: {
  value: number
  label: string
  onCommit: (px: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  const [editing, setEditing] = useState(false)
  const shown = editing ? draft : String(value)
  const commit = (raw: string) => {
    const px = clampAiCustomFontSize(raw)
    if (px !== null && px !== value) onCommit(px)
  }
  return (
    <label className="set-num">
      <input
        type="number"
        className="set-input set-num-input"
        aria-label={label}
        min={AI_CUSTOM_FONT_MIN_PX}
        max={AI_CUSTOM_FONT_MAX_PX}
        step={1}
        value={shown}
        onFocus={() => {
          setDraft(String(value))
          setEditing(true)
        }}
        onChange={(e) => {
          setDraft(e.target.value)
          const n = Number(e.target.value)
          if (Number.isInteger(n) && n >= AI_CUSTOM_FONT_MIN_PX && n <= AI_CUSTOM_FONT_MAX_PX) {
            onCommit(n)
          }
        }}
        onBlur={() => {
          commit(draft)
          setEditing(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
      />
      <span className="set-num-unit">px</span>
    </label>
  )
}

export type SectionId = 'profile' | 'aiModel' | 'aiMedia' | 'general' | 'integrations' | 'about'

const SECTIONS: readonly { id: SectionId; labelKey: StringKey }[] = [
  { id: 'profile', labelKey: 'setSecProfile' },
  { id: 'aiModel', labelKey: 'setSecAiModel' },
  { id: 'aiMedia', labelKey: 'setSecAiMedia' },
  { id: 'general', labelKey: 'setSecGeneral' },
  { id: 'integrations', labelKey: 'setSecIntegrations' },
  { id: 'about', labelKey: 'setSecAbout' },
]

function SectionIcon({ id }: { id: SectionId }) {
  if (id === 'aiModel') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M8 1.8 9.5 6l4.2 1.5L9.5 9 8 13.2 6.5 9 2.3 7.5 6.5 6 8 1.8Z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path
          d="M12.8 11.2v3M11.3 12.7h3"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  if (id === 'aiMedia') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="M2.5 11.5 6 8l2.5 2.5L10.5 9l3 2.8"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="10.5" cy="6" r="1.1" fill="currentColor" />
      </svg>
    )
  }
  if (id === 'profile') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="5.2" r="2.9" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="M2.7 13.6a5.5 5.5 0 0 1 10.6 0"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  if (id === 'integrations') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M5.5 2v3M10.5 2v3M4 5h8v2.5a4 4 0 0 1-8 0V5ZM8 11.5V14"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (id === 'general') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M2 5h8M13 5h1M2 11h1M6 11h8"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <circle cx="11.5" cy="5" r="1.7" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="4.5" cy="11" r="1.7" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.3" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 7.4v3.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="8" cy="5.1" r="0.8" fill="currentColor" />
    </svg>
  )
}

/** label-over-value field row with an optional right-aligned action */
function Field({
  label,
  value,
  valueTitle,
  action,
}: {
  label: string
  value: string
  valueTitle?: string
  action?: ReactNode
}) {
  return (
    <div className="set-field">
      <div className="set-field-text">
        <div className="set-field-label">{label}</div>
        <div className="set-field-value" data-tip={valueTitle}>
          {value}
        </div>
      </div>
      {action}
    </div>
  )
}

/**
 * Long enough that typing an address does not fire a request per keystroke,
 * short enough that the picker is populated by the time the eye reaches it.
 */
const CUSTOM_MODELS_DEBOUNCE_MS = 400

/** replace one catalog entry's model list, leaving every other entry untouched */
function foldModels(providerId: string, models: string[]) {
  return (current: AiCatalogEntry[]): AiCatalogEntry[] =>
    current.map((entry) =>
      entry.id === providerId ? { ...entry, models, defaultModel: '' } : entry,
    )
}

/** AI model pane: provider / model / key / base URL, saved to userData/ai-settings.json */
function AiModelPane({ t }: { t: TFunc }) {
  const [catalog, setCatalog] = useState<AiCatalogEntry[]>(
    () => window.aiOffice.getAiProviders?.() ?? [],
  )
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)
  /** free-typed value of the output-cap field; committed (and clamped) on blur */
  const [maxTokensDraft, setMaxTokensDraft] = useState<string | null>(null)

  const refreshCodexModels = useCallback(async (cliPath = '', selectedModel = '') => {
    if (!window.aiOffice.getCodexModels) return
    const live = await window.aiOffice.getCodexModels(cliPath)
    setCatalog((current) =>
      current.map((entry) => {
        if (entry.id !== 'codex') return entry
        const models =
          selectedModel && !live.models.includes(selectedModel)
            ? [selectedModel, ...live.models]
            : live.models
        return { ...entry, models, defaultModel: live.defaultModel }
      }),
    )
  }, [])

  useEffect(() => {
    let alive = true
    void window.aiOffice.getAiSettings?.().then((s) => {
      if (!alive || !s) return
      setSettings(s)
      const codex = s.providers.codex
      if (codex) {
        void refreshCodexModels(codex.cliPath ?? '', codex.model).catch(() => undefined)
      }
    })
    return () => {
      alive = false
    }
  }, [refreshCodexModels])

  // A user-hosted endpoint gets the same live model list as Codex, asked of the
  // endpoint itself. Keyed on the catalog's `needsBaseUrl` flag rather than on
  // the literal 'custom' id, so it follows the slot rather than the name, and
  // stays a no-op while any other provider is selected — a local server saved
  // months ago is never contacted while another provider is in use.
  // Local presets and live-catalog vendors ride the same path, falling back to
  // their default address while the Base URL field is left empty.
  const endpointEntry = catalog.find(
    (entry) => entry.id === settings?.provider && (entry.needsBaseUrl || entry.liveModels),
  )
  const endpointProvider = endpointEntry?.id
  const endpointConfig = settings ? settings.providers[settings.provider] : undefined
  const endpointBaseUrl =
    (endpointConfig?.baseUrl ?? '').trim() || (endpointEntry?.defaultBaseUrl ?? '')
  const endpointApiKey = endpointConfig?.apiKey ?? ''
  // The stored model decides where the pin goes below, but changing it must not
  // send another request, so it is read when the reply lands rather than keyed on.
  const selectedModelRef = useRef('')
  useEffect(() => {
    selectedModelRef.current = endpointConfig?.model ?? ''
  })
  /** the address that produced the list currently folded in; '' when none is */
  const listedForRef = useRef('')

  useEffect(() => {
    if (!endpointProvider) return
    // A list belonging to a different server — or to no server, once the address
    // is cleared — is misinformation, so it goes the moment the address changes:
    // the free-text box is the honest thing to show while the answer is unknown.
    if (listedForRef.current && listedForRef.current !== endpointBaseUrl) {
      listedForRef.current = ''
      setCatalog(foldModels(endpointProvider, []))
    }
    const fromAccount = !!endpointEntry?.account
    if (!fromAccount && (!endpointBaseUrl || !window.aiOffice.getCustomModels)) return
    let cancelled = false
    const timer = setTimeout(() => {
      // Faam AI Cloud lists models for the signed-in account (main holds the token)
      const probe = fromAccount
        ? (window.aiOffice.faamCloudModels?.() ?? Promise.resolve([])).then((models) => ({
            models,
            defaultModel: '',
          }))
        : window.aiOffice.getCustomModels!(endpointBaseUrl, endpointApiKey)
      void probe
        .then((live) => {
          // A server that will not answer leaves the current list alone: a blip
          // must not wipe a picker mid-use.
          if (cancelled || !live || live.models.length === 0) return
          // A hand-typed id is pinned to the top so it never vanishes from the
          // picker. The catalog is the only thing written — writing settings
          // here would revert whatever the user typed while the probe was in
          // flight, since `updateConfig` rebuilds them from its own render.
          const selected = selectedModelRef.current.trim()
          const models =
            selected && !live.models.includes(selected) ? [selected, ...live.models] : live.models
          listedForRef.current = endpointBaseUrl
          setCatalog(foldModels(endpointProvider, models))
        })
        .catch(() => undefined)
    }, CUSTOM_MODELS_DEBOUNCE_MS)
    // React's own cleanup drops a superseded reply, so a slow answer from the
    // previous address can never overwrite a fast one from the current address.
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [endpointProvider, endpointBaseUrl, endpointApiKey, endpointEntry?.account])

  if (!settings) return null
  const provider = settings.provider
  const meta = catalog.find((c) => c.id === provider)
  const config = settings.providers[provider] ?? {
    apiKey: '',
    model: meta?.defaultModel ?? '',
    baseUrl: undefined,
    cliPath: undefined,
  }
  const isCodex = provider === 'codex'

  const touch = () => {
    setDirty(true)
    setSaved(false)
    setTestResult(null)
  }
  const updateConfig = (patch: Partial<typeof config>) => {
    setSettings({
      ...settings,
      providers: { ...settings.providers, [provider]: { ...config, ...patch } },
    })
    touch()
  }
  /** Commit the output-cap input: clamp what was typed and drop a no-op edit */
  const commitMaxTokens = () => {
    if (maxTokensDraft === null) return
    setMaxTokensDraft(null)
    const next = clampMaxOutputTokens(Number.parseInt(maxTokensDraft, 10))
    if (next === (settings.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS)) return
    setSettings({ ...settings, maxOutputTokens: next })
    touch()
  }
  const selectProvider = (id: AiSettings['provider']) => {
    setSettings({ ...settings, provider: id })
    touch()
  }
  const save = () => {
    window.aiOffice
      .setAiSettings?.(settings)
      .then(() => {
        setDirty(false)
        setSaved(true)
      })
      .catch((error) => {
        window.alert(error instanceof Error ? error.message : String(error))
      })
  }
  const test = () => {
    setTesting(true)
    setTestResult(null)
    window.aiOffice
      .testAiSettings?.(settings)
      .then((r) => {
        setTestResult(r ?? { ok: false })
        if (r?.ok && isCodex) {
          void refreshCodexModels(config.cliPath ?? '', config.model).catch(() => undefined)
        }
      })
      .catch((error) =>
        setTestResult({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      )
      .finally(() => setTesting(false))
  }

  return (
    <>
      <div className="set-pane-head">
        <h3 className="set-pane-title">{t('setSecAiModel')}</h3>
        <div className="set-pane-actions">
          <AiStatusPill
            status={
              testing
                ? { kind: 'testing', text: t('setAiTesting') }
                : testResult
                  ? testResult.ok
                    ? { kind: 'ok', text: t('setAiTestOk') }
                    : { kind: 'err', text: testResult.error || t('setAiTestFail') }
                  : saved
                    ? { kind: 'ok', text: t('setAiSaved') }
                    : null
            }
          />
          <button className="set-btn" disabled={testing} onClick={test}>
            {t('setAiTest')}
          </button>
          <button className="set-btn primary" disabled={!dirty} onClick={save}>
            {t('setAiSave')}
          </button>
        </div>
      </div>
      <div className="set-field">
        <div className="set-field-text">
          <label className="set-field-label">{t('setAiProvider')}</label>
        </div>
        <Dropdown
          className="set-dd"
          value={provider}
          ariaLabel={t('setAiProvider')}
          options={orderedProviders(catalog).map((c) => ({
            value: c.id,
            label: c.label,
            render: (
              <>
                <ProviderLogo id={c.id} />
                {c.label}
              </>
            ),
          }))}
          onPick={(v) => selectProvider(v as AiSettings['provider'])}
        />
      </div>
      <div className="set-field-desc set-ai-note">
        {isCodex
          ? t('setAiCodexHint')
          : meta?.account
            ? t('setAiFaamCloudNote')
            : meta?.local
              ? t('setAiLocalNote')
              : t('setAiByokNote')}
      </div>
      {meta?.local && <LocalAiGuide t={t} provider={provider} url={endpointBaseUrl} />}
      <div className="set-field">
        <div className="set-field-text">
          <label className="set-field-label">{t('setAiModelId')}</label>
        </div>
        {meta && meta.models.length > 0 ? (
          <Dropdown
            className="set-dd"
            value={config.model || meta.defaultModel}
            ariaLabel={t('setAiModelId')}
            options={meta.models.map((m) => ({ value: m, label: m }))}
            onPick={(m) => updateConfig({ model: m })}
          />
        ) : (
          <input
            id="set-ai-model"
            className="set-input"
            type="text"
            value={config.model}
            placeholder="model-id"
            spellCheck={false}
            onChange={(e) => updateConfig({ model: e.target.value })}
          />
        )}
      </div>
      {isCodex ? (
        <div className="set-field">
          <div className="set-field-text">
            <div className="set-field-stack">
              <label className="set-field-label" htmlFor="set-ai-cli-path">
                {t('setAiCodexPath')}
              </label>
              <div className="set-field-desc">{t('setAiCodexPathHint')}</div>
            </div>
          </div>
          <input
            id="set-ai-cli-path"
            className="set-input"
            type="text"
            value={config.cliPath ?? ''}
            placeholder={t('setAiCodexAutoPlaceholder')}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => updateConfig({ cliPath: e.target.value.trim() })}
            onBlur={(e) => {
              const cliPath = e.target.value.trim()
              void refreshCodexModels(cliPath, config.model).catch(() => undefined)
            }}
          />
        </div>
      ) : meta?.account ? null : (
        <>
          <div className="set-field">
            <div className="set-field-text">
              <div className="set-field-stack">
                <label className="set-field-label" htmlFor="set-ai-key">
                  {t('setAiApiKey')}
                </label>
                <div className="set-field-desc">{t('setAiKeyHint')}</div>
              </div>
            </div>
            {PROVIDER_KEY_PAGES.has(provider) && (
              <button
                className="set-btn"
                onClick={() => void window.aiOffice.openAiProviderPage(provider)}
              >
                {t('setAiGetKey')}
              </button>
            )}
            <input
              id="set-ai-key"
              className="set-input"
              type="password"
              value={config.apiKey}
              placeholder={meta?.keyPlaceholder ?? 'API Key'}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => updateConfig({ apiKey: e.target.value.trim() })}
            />
          </div>
          <div className="set-field">
            <div className="set-field-text">
              <div className="set-field-stack">
                <label className="set-field-label" htmlFor="set-ai-base-url">
                  {t('setAiBaseUrl')}
                </label>
                {!meta?.needsBaseUrl && (
                  <div className="set-field-desc">{t('setAiBaseUrlHint')}</div>
                )}
              </div>
            </div>
            <input
              id="set-ai-base-url"
              className="set-input"
              type="text"
              value={config.baseUrl ?? ''}
              placeholder={meta?.needsBaseUrl ? 'https://…/v1' : meta?.defaultBaseUrl}
              spellCheck={false}
              onChange={(e) => updateConfig({ baseUrl: e.target.value.trim() })}
            />
          </div>
        </>
      )}
      <div className="set-field">
        <div className="set-field-text">
          <div className="set-field-stack">
            <label className="set-field-label" htmlFor="set-ai-max-tokens">
              {t('setAiMaxTokens')}
            </label>
            <div className="set-field-desc">{t('setAiMaxTokensDesc')}</div>
          </div>
        </div>
        <input
          id="set-ai-max-tokens"
          className="set-input"
          type="number"
          min={MIN_MAX_OUTPUT_TOKENS}
          max={MAX_MAX_OUTPUT_TOKENS}
          step={1024}
          value={maxTokensDraft ?? String(settings.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS)}
          onChange={(e) => setMaxTokensDraft(e.target.value)}
          onBlur={commitMaxTokens}
        />
      </div>
    </>
  )
}

/** popular hosted vendors first, then local servers, then the rest in catalog order */
const PROVIDER_ORDER: readonly string[] = [
  'faamcloud',
  'openai',
  'anthropic',
  'gemini',
  'deepseek',
  'xai',
  'mistral',
  'groq',
  'openrouter',
  'qwen',
  'kimi',
  'glm',
  'minimax',
  'ollama',
  'lmstudio',
  'llamacpp',
  'custom',
  'codex',
]

function orderedProviders<T extends { id: string }>(catalog: T[]): T[] {
  const rank = (id: string) => {
    const i = PROVIDER_ORDER.indexOf(id)
    return i === -1 ? PROVIDER_ORDER.length : i
  }
  return [...catalog].sort((a, b) => rank(a.id) - rank(b.id))
}

/** vendors whose API-key page the main process can open (its own allowlist decides the URL) */
const PROVIDER_KEY_PAGES: ReadonlySet<string> = new Set([
  'openai',
  'anthropic',
  'gemini',
  'deepseek',
  'xai',
  'mistral',
  'groq',
  'openrouter',
])

/** per-server setup: download, fetch a tool-calling model, start the server */
const LOCAL_AI_STEPS: Record<string, { step: StringKey; code?: string }[]> = {
  ollama: [
    { step: 'setAiLocalStepInstall' },
    { step: 'setAiLocalStepModel', code: 'ollama pull qwen3' },
    { step: 'setAiLocalStepPick' },
  ],
  lmstudio: [
    { step: 'setAiLocalStepInstall' },
    { step: 'setAiLocalStepModel', code: 'lms get qwen3' },
    { step: 'setAiLocalStepServe', code: 'lms server start' },
    { step: 'setAiLocalStepPick' },
  ],
  llamacpp: [
    { step: 'setAiLocalStepInstall', code: 'brew install llama.cpp' },
    {
      step: 'setAiLocalStepServe',
      code: 'llama-server -hf ggml-org/Qwen3-8B-GGUF --jinja --port 8080',
    },
    { step: 'setAiLocalStepPick' },
  ],
}

/** Setup guide shown while a local AI server (Ollama, LM Studio, llama.cpp) is selected */
function LocalAiGuide({ t, provider, url }: { t: TFunc; provider: string; url: string }) {
  const steps = LOCAL_AI_STEPS[provider]
  if (!steps) return null
  return (
    <div className="set-local-guide">
      <div className="set-local-guide-head">
        <span className="set-field-label">{t('setAiLocalGuideTitle')}</span>
        <button
          className="set-btn"
          onClick={() => void window.aiOffice.openAiProviderPage(provider)}
        >
          {t('setAiLocalDownload')}
        </button>
      </div>
      <ol className="set-local-steps">
        {steps.map(({ step, code }, i) => (
          <li key={i}>
            <span>{t(step, { url })}</span>
            {code && <code className="set-local-code">{code}</code>}
          </li>
        ))}
      </ol>
      <div className="set-field-desc">{t('setAiLocalToolsTip')}</div>
    </div>
  )
}

type Capability = 'image' | 'analysis' | 'video' | 'search'
/** a tested block: the four capabilities plus the Jev reranker of the local file search */
type TestedBlock = Capability | 'rerank'
/** where an outside entry point (e.g. the home list's Jev button) lands when it opens the modal */
export interface SettingsTarget {
  section: SectionId
  block?: TestedBlock
}
type TestResult = { ok: boolean; error?: string }

const JEV_ENDPOINTS: { value: JevEndpoint; label: string }[] = [
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'direct', label: 'TypeSafe' },
]

/**
 * AI media & search pane, one block per capability — web search, image
 * generation, image analysis, video analysis — each with the same
 * provider / model / key / base URL rows as the AI Model pane. A vendor's key
 * and base URL are stored once and shared by every block that picks it.
 * Saved into the same ai-settings.json as the chat provider.
 */
function AiMediaPane({
  t,
  onFileSearchChange,
  focusBlock,
}: {
  t: TFunc
  onFileSearchChange?: () => void
  focusBlock?: TestedBlock
}) {
  const [mediaCatalog] = useState<AiMediaProviderMeta[]>(
    () => window.aiOffice.getAiMediaProviders?.() ?? [],
  )
  const [searchCatalog] = useState<AiSearchProviderMeta[]>(
    () => window.aiOffice.getAiSearchProviders?.() ?? [],
  )
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [fileSearch, setFileSearchState] = useState<FileSearchSettings | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResults, setTestResults] = useState<Partial<Record<TestedBlock, TestResult>> | null>(
    null,
  )
  const focused = useRef(false)
  const scrollToFocused = (el: HTMLDivElement | null) => {
    if (!el || focused.current) return
    focused.current = true
    el.scrollIntoView({ block: 'start' })
  }

  useEffect(() => {
    let alive = true
    void window.aiOffice.getAiSettings?.().then((s) => {
      if (alive && s) setSettings(s)
    })
    void window.aiOffice.getFileSearchSettings?.().then((v) => {
      if (alive && v) setFileSearchState(v)
    })
    return () => {
      alive = false
    }
  }, [])

  if (!settings?.media || !settings.search) return null
  const media: AiMediaSettings = settings.media
  const search: AiSearchSettings = settings.search

  const touch = () => {
    setDirty(true)
    setSaved(false)
    setTestResults(null)
  }
  const setMedia = (next: AiMediaSettings) => {
    setSettings({ ...settings, media: next })
    touch()
  }
  const setSearch = (next: AiSearchSettings) => {
    setSettings({ ...settings, search: next })
    touch()
  }
  const setFileSearch = (next: FileSearchSettings) => {
    setFileSearchState(next)
    touch()
  }
  const mediaConfigOf = (id: AiMediaProviderId) => {
    const meta = mediaCatalog.find((m) => m.id === id)
    return (
      media.providers[id] ?? {
        apiKey: '',
        imageModel: meta?.defaultImageModel ?? '',
        analysisModel: meta?.defaultAnalysisModel ?? '',
      }
    )
  }
  const updateMediaConfig = (
    id: AiMediaProviderId,
    patch: Partial<AiMediaSettings['providers'][AiMediaProviderId]>,
  ) =>
    setMedia({
      ...media,
      providers: { ...media.providers, [id]: { ...mediaConfigOf(id), ...patch } },
    })

  const save = () => {
    Promise.all([
      window.aiOffice.setAiSettings?.(settings),
      fileSearch ? window.aiOffice.setFileSearchSettings?.(fileSearch) : undefined,
    ])
      .then(() => {
        setDirty(false)
        setSaved(true)
        onFileSearchChange?.()
      })
      .catch((error) => {
        window.alert(error instanceof Error ? error.message : String(error))
      })
  }
  // every block reports its own verdict; blocks sharing a vendor share that vendor's one check
  const test = async () => {
    setTesting(true)
    setTestResults(null)
    const results: Partial<Record<TestedBlock, TestResult>> = {}
    const fallback: TestResult = { ok: true }
    const vendorChecks = new Map<AiMediaProviderId, Promise<TestResult>>()
    const vendorCheck = (id: AiMediaProviderId) => {
      let pending = vendorChecks.get(id)
      if (!pending) {
        pending =
          window.aiOffice.testAiMediaSettings?.({ provider: id, config: mediaConfigOf(id) }) ??
          Promise.resolve(fallback)
        vendorChecks.set(id, pending)
      }
      return pending
    }
    const blocks: [TestedBlock, () => Promise<TestResult>][] = [
      [
        'search',
        () =>
          window.aiOffice.testAiSearchSettings?.({
            provider: search.provider,
            apiKey:
              search.provider === 'auto' ? '' : (search.providers[search.provider]?.apiKey ?? ''),
          }) ?? Promise.resolve(fallback),
      ],
      ['image', () => vendorCheck(media.imageProvider)],
      ['analysis', () => vendorCheck(media.analysisProvider)],
      ['video', () => vendorCheck(media.videoAnalysisProvider)],
    ]
    if (fileSearch?.rerank) {
      blocks.push([
        'rerank',
        () =>
          window.aiOffice.testFileSearchRerank?.({
            endpoint: fileSearch.jevEndpoint,
            apiKey: fileSearch.jevKeys[fileSearch.jevEndpoint],
          }) ?? Promise.resolve(fallback),
      ])
    }
    await Promise.all(
      blocks.map(async ([block, run]) => {
        try {
          results[block] = await run()
        } catch (error) {
          results[block] = {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      }),
    )
    setTestResults(results)
    setTesting(false)
  }

  const blockLabel = (block: TestedBlock) =>
    block === 'search'
      ? t('setAiCapSearch')
      : block === 'image'
        ? t('setAiCapImage')
        : block === 'analysis'
          ? t('setAiCapAnalysis')
          : block === 'video'
            ? t('setAiCapVideo')
            : t('setAiCapFileSearch')
  const blockProvider = (block: TestedBlock) => {
    if (block === 'rerank')
      return JEV_ENDPOINTS.find((e) => e.value === fileSearch?.jevEndpoint)?.label ?? ''
    if (block === 'search')
      return searchCatalog.find((m) => m.id === search.provider)?.label ?? search.provider
    const id =
      block === 'image'
        ? media.imageProvider
        : block === 'video'
          ? media.videoAnalysisProvider
          : media.analysisProvider
    return mediaCatalog.find((m) => m.id === id)?.label ?? id
  }
  const blockStatus = (block: TestedBlock): AiStatus | null => {
    if (testing) return { kind: 'testing', text: t('setAiTesting') }
    const r = testResults?.[block]
    if (!r) return null
    return r.ok
      ? { kind: 'ok', text: t('setAiTestOk') }
      : { kind: 'err', text: r.error || t('setAiTestFail') }
  }
  const subhead = (block: TestedBlock, title: string) => (
    <div className="set-pane-subhead" ref={block === focusBlock ? scrollToFocused : undefined}>
      <h4 className="set-pane-subtitle">{title}</h4>
      <AiStatusPill status={blockStatus(block)} />
    </div>
  )
  const failed = testResults
    ? (Object.keys(testResults) as TestedBlock[]).filter((b) => !testResults[b]?.ok)
    : []
  const headStatus: AiStatus | null = testing
    ? { kind: 'testing', text: t('setAiTesting') }
    : testResults
      ? failed.length === 0
        ? { kind: 'ok', text: t('setAiTestOk') }
        : {
            kind: 'err',
            text: `${blockLabel(failed[0]!)} · ${blockProvider(failed[0]!)}: ${testResults[failed[0]!]?.error || t('setAiTestFail')}`,
          }
      : saved
        ? { kind: 'ok', text: t('setAiSaved') }
        : null

  const providerRow = (
    label: string,
    value: string,
    options: { id: string; label: string }[],
    onPick: (id: string) => void,
  ) => (
    <div className="set-field">
      <div className="set-field-text">
        <label className="set-field-label">{t('setAiProvider')}</label>
      </div>
      <Dropdown
        className="set-dd"
        value={value}
        ariaLabel={label}
        options={options.map((c) => ({
          value: c.id,
          label: c.label,
          render: (
            <>
              <ProviderLogo id={c.id} />
              {c.label}
            </>
          ),
        }))}
        onPick={onPick}
      />
    </div>
  )

  const modelRow = (
    id: string,
    models: string[],
    fallback: string,
    value: string,
    onChange: (v: string) => void,
  ) => (
    <div className="set-field">
      <div className="set-field-text">
        <label className="set-field-label" htmlFor={id}>
          {t('setAiModelId')}
        </label>
      </div>
      {models.length > 0 ? (
        <Dropdown
          className="set-dd"
          value={value || fallback}
          ariaLabel={t('setAiModelId')}
          options={models.map((m) => ({ value: m, label: m }))}
          onPick={onChange}
        />
      ) : (
        <input
          id={id}
          className="set-input"
          type="text"
          value={value}
          placeholder="model-id"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  )

  const keyRow = (
    id: string,
    value: string,
    placeholder: string,
    onChange: (v: string) => void,
  ) => (
    <div className="set-field">
      <div className="set-field-text">
        <div className="set-field-stack">
          <label className="set-field-label" htmlFor={id}>
            {t('setAiApiKey')}
          </label>
          <div className="set-field-desc">{t('setAiKeyHint')}</div>
        </div>
      </div>
      <input
        id={id}
        className="set-input"
        type="password"
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value.trim())}
      />
    </div>
  )

  const baseUrlRow = (
    id: string,
    meta: AiMediaProviderMeta,
    value: string,
    onChange: (v: string) => void,
  ) => (
    <div className="set-field">
      <div className="set-field-text">
        <div className="set-field-stack">
          <label className="set-field-label" htmlFor={id}>
            {t('setAiBaseUrl')}
          </label>
          {!meta.needsBaseUrl && <div className="set-field-desc">{t('setAiBaseUrlHint')}</div>}
        </div>
      </div>
      <input
        id={id}
        className="set-input"
        type="text"
        value={value}
        placeholder={meta.needsBaseUrl ? 'https://…/v1' : meta.defaultBaseUrl}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value.trim())}
      />
    </div>
  )

  /** one media block: provider → model → key → base URL (key/base URL shared per vendor) */
  const mediaBlock = (cap: Exclude<Capability, 'search'>) => {
    const title =
      cap === 'image'
        ? t('setAiCapImage')
        : cap === 'analysis'
          ? t('setAiCapAnalysis')
          : t('setAiCapVideo')
    const options = mediaCatalog.filter((m) =>
      cap === 'image'
        ? !!m.imageProtocol
        : cap === 'video'
          ? !!m.analysisProtocol && m.videoAnalysis
          : !!m.analysisProtocol,
    )
    const current =
      cap === 'image'
        ? media.imageProvider
        : cap === 'video'
          ? media.videoAnalysisProvider
          : media.analysisProvider
    const meta = options.find((m) => m.id === current) ?? options[0]!
    const id = meta.id
    const config = mediaConfigOf(id)
    const pick = (next: string) => {
      const p = next as AiMediaProviderId
      setMedia(
        cap === 'image'
          ? { ...media, imageProvider: p }
          : cap === 'video'
            ? { ...media, videoAnalysisProvider: p }
            : { ...media, analysisProvider: p },
      )
    }
    const modelField = cap === 'image' ? 'imageModel' : 'analysisModel'
    return (
      <section key={cap}>
        {subhead(cap, title)}
        {providerRow(title, id, options, pick)}
        <div className="set-field-desc set-ai-note">{meta.description}</div>
        <>
          {modelRow(
            `set-ai-${cap}-model`,
            cap === 'image' ? meta.imageModels : meta.analysisModels,
            cap === 'image' ? meta.defaultImageModel : meta.defaultAnalysisModel,
            config[modelField],
            (m) => updateMediaConfig(id, { [modelField]: m }),
          )}
          {keyRow(`set-ai-${cap}-key`, config.apiKey, meta.keyPlaceholder, (v) =>
            updateMediaConfig(id, { apiKey: v }),
          )}
          {baseUrlRow(`set-ai-${cap}-base-url`, meta, config.baseUrl ?? '', (v) =>
            updateMediaConfig(id, { baseUrl: v }),
          )}
        </>
      </section>
    )
  }

  const searchMeta = searchCatalog.find((m) => m.id === search.provider)
  const searchKey =
    search.provider === 'auto' ? '' : (search.providers[search.provider]?.apiKey ?? '')

  return (
    <>
      <div className="set-pane-head">
        <h3 className="set-pane-title">{t('setSecAiMedia')}</h3>
        <div className="set-pane-actions">
          <AiStatusPill status={headStatus} />
          <button className="set-btn" disabled={testing} onClick={() => void test()}>
            {t('setAiTest')}
          </button>
          <button className="set-btn primary" disabled={!dirty} onClick={save}>
            {t('setAiSave')}
          </button>
        </div>
      </div>
      <div className="set-field-desc set-ai-note">{t('setAiSharedKeyHint')}</div>
      <section>
        {subhead('search', t('setAiCapSearch'))}
        {providerRow(t('setAiCapSearch'), search.provider, searchCatalog, (v) =>
          setSearch({ ...search, provider: v as AiSearchSettings['provider'] }),
        )}
        <div className="set-field-desc set-ai-note">
          {search.provider === 'auto'
            ? t('setAiSearchAutoHint')
            : search.provider === 'parallel'
              ? t('setAiSearchParallelHint')
              : search.provider === 'serply'
                ? t('setAiSearchSerplyHint')
                : searchMeta?.imageSearch
                  ? t('setAiSearchSerperHint')
                  : t('setAiSearchTavilyHint')}
        </div>
        {search.provider !== 'auto' &&
          keyRow('set-ai-search-key', searchKey, searchMeta?.keyPlaceholder ?? 'API Key', (v) =>
            setSearch({
              ...search,
              providers: { ...search.providers, [search.provider]: { apiKey: v } },
            }),
          )}
      </section>
      {fileSearch && (
        <section>
          {subhead('rerank', t('setAiCapFileSearch'))}
          <div className="set-field">
            <div className="set-field-text">
              <div className="set-field-stack">
                <div className="set-field-label">{t('setSearchRerank')}</div>
                <div className="set-field-desc">{t('setSearchRerankDesc')}</div>
              </div>
            </div>
            <button
              className="set-switch"
              role="switch"
              aria-checked={fileSearch.rerank}
              aria-label={t('setSearchRerank')}
              onClick={() => setFileSearch({ ...fileSearch, rerank: !fileSearch.rerank })}
            />
          </div>
          {fileSearch.rerank && (
            <>
              <div className="set-field">
                <div className="set-field-text">
                  <label className="set-field-label">{t('setSearchRerankEndpoint')}</label>
                </div>
                <Dropdown
                  className="set-dd"
                  value={fileSearch.jevEndpoint}
                  ariaLabel={t('setSearchRerankEndpoint')}
                  options={JEV_ENDPOINTS}
                  onPick={(v) =>
                    setFileSearch({
                      ...fileSearch,
                      jevEndpoint: v === 'direct' ? 'direct' : 'openrouter',
                    })
                  }
                />
              </div>
              {keyRow(
                'set-search-jev-key',
                fileSearch.jevKeys[fileSearch.jevEndpoint],
                fileSearch.jevEndpoint === 'openrouter' ? 'sk-or-…' : 'API Key',
                (v) =>
                  setFileSearch({
                    ...fileSearch,
                    jevKeys: { ...fileSearch.jevKeys, [fileSearch.jevEndpoint]: v },
                  }),
              )}
            </>
          )}
        </section>
      )}
      {mediaBlock('image')}
      {mediaBlock('analysis')}
      {mediaBlock('video')}
    </>
  )
}

interface AiStatus {
  kind: 'testing' | 'ok' | 'err'
  text: string
}

/** colored feedback pill in the AI pane header: spinner while testing, then success/error */
function AiStatusPill({ status }: { status: AiStatus | null }) {
  if (!status) return null
  return (
    <span
      className={`set-ai-status ${status.kind}`}
      role="status"
      // error text (HTTP body, network message) can be long — full text via native tooltip
      title={status.kind === 'err' ? status.text : undefined}
    >
      {status.kind === 'testing' ? (
        <span className="set-ai-spin" aria-hidden="true" />
      ) : status.kind === 'ok' ? (
        <svg
          className="set-ai-status-icon"
          width="14"
          height="14"
          viewBox="0 0 14 14"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="6.3" fill="currentColor" opacity="0.16" />
          <path
            d="M4.2 7.3l1.9 1.9 3.7-4.3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      ) : (
        <svg
          className="set-ai-status-icon"
          width="14"
          height="14"
          viewBox="0 0 14 14"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="6.3" fill="currentColor" opacity="0.16" />
          <path d="M7 3.8v3.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="7" cy="10.1" r="1" fill="currentColor" />
        </svg>
      )}
      <span className="set-ai-status-text">{status.text}</span>
    </span>
  )
}

/**
 * Local profile: FaamOffice has no account, so the only identity is a display
 * name kept in app-settings.json (greeting + sidebar avatar). Saved on blur.
 */
function ProfilePane({ t }: { t: TFunc }) {
  const [name, setName] = useState('')
  const stored = useRef('')
  useEffect(() => {
    let alive = true
    void window.aiOffice.getProfile?.().then((p) => {
      if (!alive) return
      stored.current = p.name
      setName(p.name)
    })
    return () => {
      alive = false
    }
  }, [])
  const commit = () => {
    const next = name.trim()
    if (next === stored.current) return
    stored.current = next
    void window.aiOffice.setProfile?.({ name: next })
  }
  return (
    <>
      <h3 className="set-pane-title">{t('setSecProfile')}</h3>
      <div className="set-field">
        <div className="set-field-text">
          <div className="set-field-stack">
            <label className="set-field-label" htmlFor="set-profile-name">
              {t('setProfileName')}
            </label>
            <div className="set-field-desc">{t('setProfileNameHint')}</div>
          </div>
        </div>
        <input
          id="set-profile-name"
          className="set-input"
          type="text"
          value={name}
          maxLength={80}
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
          }}
        />
      </div>
      <div className="set-field-desc set-ai-note">{t('setProfileLocalNote')}</div>
      <FaamAccountBlock t={t} />
    </>
  )
}

const FAAM_ERROR_KEYS = {
  network: 'setFaamErrNetwork',
  expired: 'setFaamErrExpired',
  denied: 'setFaamErrDenied',
  failed: 'setFaamErrFailed',
} as const satisfies Record<Extract<FaamAccountEvent, { phase: 'error' }>['error'], StringKey>

/**
 * Optional FaamOffice account: browser sign-in with a device code, the live
 * credit balance, sign-out, and the account server address. Signing in unlocks
 * the Faam AI Cloud provider; nothing else in the app needs an account.
 */
function FaamAccountBlock({ t }: { t: TFunc }) {
  const [info, setInfo] = useState<FaamAccountInfo | null>(null)
  const [waitingCode, setWaitingCode] = useState<string | null>(null)
  const [error, setError] = useState<keyof typeof FAAM_ERROR_KEYS | null>(null)
  const [serverDraft, setServerDraft] = useState<string | null>(null)
  const [serverInvalid, setServerInvalid] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    void window.aiOffice.faamAccountStatus?.().then(setInfo)
  }, [])

  useEffect(() => {
    refresh()
    const off = window.aiOffice.onFaamAccountEvent?.((ev) => {
      if (ev.phase === 'code') {
        setWaitingCode(ev.userCode)
        setError(null)
      } else if (ev.phase === 'success') {
        setWaitingCode(null)
        refresh()
      } else {
        setWaitingCode(null)
        setError(ev.error)
      }
    })
    return () => off?.()
  }, [refresh])

  const signIn = () => {
    setError(null)
    void window.aiOffice.faamAccountLogin?.()
  }
  const cancel = () => {
    setWaitingCode(null)
    void window.aiOffice.faamAccountCancelLogin?.()
  }
  const signOut = () => {
    setBusy(true)
    void window.aiOffice
      .faamAccountLogout?.()
      .then(refresh)
      .finally(() => setBusy(false))
  }
  const commitServer = () => {
    if (serverDraft === null) return
    const draft = serverDraft.trim()
    setServerDraft(null)
    if (!draft || draft === info?.server) return
    void window.aiOffice.faamAccountSetServer?.(draft).then((normalized) => {
      setServerInvalid(!normalized)
      refresh()
    })
  }

  const signedIn = info?.signedIn ?? false
  return (
    <section className="set-account" aria-label={t('setFaamAccount')}>
      <div className="set-field">
        <div className="set-field-text">
          <div className="set-field-stack">
            <div className="set-field-label">{t('setFaamAccount')}</div>
            <div className="set-field-desc">
              {signedIn
                ? [
                    info?.email || info?.name,
                    typeof info?.credits === 'number'
                      ? t('setFaamCredits', { n: info.credits.toLocaleString() })
                      : null,
                    info?.offline ? t('setFaamOffline') : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : t('setFaamAccountDesc')}
            </div>
          </div>
        </div>
        <div className="set-account-actions">
          {signedIn ? (
            <>
              <button
                className="set-btn"
                onClick={() => void window.aiOffice.faamAccountOpenWeb?.('account')}
              >
                {t('setFaamManage')}
              </button>
              <button className="set-btn" disabled={busy} onClick={signOut}>
                {t('setFaamSignOut')}
              </button>
            </>
          ) : waitingCode ? (
            <button className="set-btn" onClick={cancel}>
              {t('cancel')}
            </button>
          ) : (
            <>
              <button
                className="set-btn"
                onClick={() => void window.aiOffice.faamAccountOpenWeb?.('register')}
              >
                {t('setFaamRegister')}
              </button>
              <button className="set-btn primary" onClick={signIn}>
                {t('setFaamSignIn')}
              </button>
            </>
          )}
        </div>
      </div>
      {waitingCode && (
        <div className="set-field-desc set-ai-note" role="status">
          {t('setFaamWaiting', { code: waitingCode })}
        </div>
      )}
      {error && (
        <div className="set-field-desc set-ai-note set-account-error" role="alert">
          {t(FAAM_ERROR_KEYS[error])}
        </div>
      )}
      <div className="set-field">
        <div className="set-field-text">
          <div className="set-field-stack">
            <label className="set-field-label" htmlFor="set-faam-server">
              {t('setFaamServer')}
            </label>
            <div className="set-field-desc">
              {serverInvalid ? t('setFaamServerInvalid') : t('setFaamServerHint')}
            </div>
          </div>
        </div>
        <input
          id="set-faam-server"
          className="set-input"
          type="url"
          value={serverDraft ?? info?.server ?? ''}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setServerDraft(e.target.value)}
          onBlur={commitServer}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitServer()
          }}
        />
      </div>
    </section>
  )
}

export interface SettingsModalProps {
  onClose: () => void
  /** the Jev search settings were saved; the home search re-judges or drops its current order */
  onFileSearchChange?: () => void
  /** an installed skill is older than the bundled one: dot on the Integrations entry */
  skillUpdateDue?: boolean
  onSkillUpdateDue?: (due: boolean) => void
  /** open on this section / block instead of the profile page */
  target?: SettingsTarget | null
}

export function SettingsModal({
  onClose,
  onFileSearchChange,
  skillUpdateDue: updateDue = false,
  onSkillUpdateDue,
  target,
}: SettingsModalProps) {
  const { lang, setLang, t, dateLocale } = useI18n()
  const [section, setSection] = useState<SectionId>(target?.section ?? 'profile')
  const [theme, setTheme] = useState<UiTheme>('system')
  const [docTheme, setDocTheme] = useState<DocTheme>('follow')
  const [saveDir, setSaveDir] = useState('')
  const [analyticsOn, setAnalyticsOn] = useState(true)
  const [analyticsSaving, setAnalyticsSaving] = useState(false)
  const [autoSaveOn, setAutoSaveOn] = useState(false)
  const [defaultApp, setDefaultApp] = useState<DefaultAppStatus | null>(null)
  const [defaultAppBusy, setDefaultAppBusy] = useState(false)
  const [defaultAppFailed, setDefaultAppFailed] = useState(false)
  const [aiPrefs, setAiPrefs] = useState<AiPanelPrefs>(DEFAULT_AI_PANEL_PREFS)
  const [channel, setChannel] = useState<'stable' | 'beta'>('stable')
  const [appVersion, setAppVersion] = useState('')
  const [githubStars, setGithubStars] = useState<number | null>(null)
  const [updateState, setUpdateState] = useState<UpdateUiState | null>(null)

  useEffect(() => {
    let alive = true
    void window.aiOffice.getTheme?.().then((th) => {
      if (alive) setTheme(th)
    })
    void window.aiOffice.getDocumentTheme?.().then((th) => {
      if (alive) setDocTheme(th)
    })
    void window.aiOffice.getDefaultSaveDir?.().then((dir) => {
      if (alive && dir) setSaveDir(dir)
    })
    void window.aiOffice.getAnalyticsEnabled?.().then((on) => {
      if (alive) setAnalyticsOn(on !== false)
    })
    void window.aiOffice.getAutoSaveDefault?.().then((v) => {
      if (alive) setAutoSaveOn(v.on)
    })
    void window.aiOffice.getDefaultAppStatus?.().then((st) => {
      if (alive) setDefaultApp(st)
    })
    void window.aiOffice.getAiPanelPrefs?.().then((prefs) => {
      if (alive) setAiPrefs(prefs)
    })
    void window.aiOffice.getUpdateChannel?.().then((ch) => {
      if (alive) setChannel(ch)
    })
    void window.aiOffice.getAppVersion?.().then((v) => {
      if (alive && v) setAppVersion(v)
    })
    // a rejected invoke (main process not ready, a shell whose preload does
    // not expose the channel) must not surface as an unhandled rejection;
    // without a known state the About row simply stays hidden
    void window.aiOffice
      .getUpdateState?.()
      .then((s) => {
        if (alive) setUpdateState(s)
      })
      .catch(() => undefined)
    void window.aiOffice.githubStars?.().then((n) => {
      if (alive && n !== null) setGithubStars(n)
    })
    return () => {
      alive = false
    }
  }, [])

  // live update state: the About row offers the update as soon as one is known
  useEffect(() => {
    const off = window.aiOffice.onUpdateStateChanged?.((s) => setUpdateState(s))
    return () => off?.()
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const applyTheme = (next: UiTheme) => {
    setTheme(next)
    void window.aiOffice.setTheme(next)
    if (next === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', next)
  }

  const applyDocumentTheme = (next: DocTheme) => {
    setDocTheme(next)
    void window.aiOffice.setDocumentTheme(next)
  }

  const updateAiPrefs = (patch: Partial<AiPanelPrefs>) => {
    setAiPrefs((prev) => ({ ...prev, ...patch }))
    void window.aiOffice.setAiPanelPrefs(patch).then(setAiPrefs)
  }

  const changeSaveDir = () => {
    void window.aiOffice.pickDefaultSaveDir?.().then((dir) => {
      if (dir) setSaveDir(dir)
    })
  }

  // Windows only opens the system page; re-read ownership when the user comes back
  useEffect(() => {
    if (!defaultApp?.manualOnly) return
    const refresh = () => {
      void window.aiOffice.getDefaultAppStatus?.().then(setDefaultApp)
    }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [defaultApp?.manualOnly])

  const claimDefaultApp = () => {
    setDefaultAppBusy(true)
    setDefaultAppFailed(false)
    void window.aiOffice
      .setDefaultApp()
      .then((st) => {
        setDefaultApp(st)
        if (!st.manualOnly && st.state !== 'default') setDefaultAppFailed(true)
      })
      .catch(() => setDefaultAppFailed(true))
      .finally(() => setDefaultAppBusy(false))
  }

  const defaultAppDesc = (() => {
    if (!defaultApp) return ''
    if (defaultAppFailed) return t('setDefaultAppFailed')
    if (defaultApp.state === 'default') return t('setDefaultAppIs')
    // Windows reports ProgId descriptions ("Microsoft Word Document"), not app
    // names, so only name the owner where the names are real
    if (defaultApp.state === 'other' && defaultApp.others.length > 0 && !defaultApp.manualOnly)
      return t('setDefaultAppOther', { app: formatList(dateLocale, defaultApp.others) })
    return t('setDefaultAppDesc')
  })()

  return (
    <div
      className="set-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="set-dialog" role="dialog" aria-modal="true" aria-label={t('settings')}>
        <div className="set-header">
          <h2 className="set-title">{t('settings')}</h2>
          <button className="set-close" onClick={onClose} aria-label={t('cancel')}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path
                d="M2 2l10 10M12 2L2 12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="set-body">
          <nav className="set-nav" aria-label={t('settings')}>
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={`set-nav-item${section === s.id ? ' active' : ''}`}
                aria-current={section === s.id}
                onClick={() => setSection(s.id)}
              >
                <SectionIcon id={s.id} />
                {t(s.labelKey)}
                {s.id === 'integrations' && updateDue && (
                  <span className="set-nav-dot" role="img" aria-label={t('intgUpdateDue')} />
                )}
              </button>
            ))}
          </nav>
          <div className="set-pane">
            {section === 'profile' && <ProfilePane t={t} />}
            {section === 'aiModel' && <AiModelPane t={t} />}
            {section === 'aiMedia' && (
              <AiMediaPane
                t={t}
                onFileSearchChange={onFileSearchChange}
                focusBlock={target?.block}
              />
            )}
            {section === 'general' && (
              <>
                <h3 className="set-pane-title">{t('setSecGeneral')}</h3>
                <div className="set-field">
                  <div className="set-field-text">
                    <label className="set-field-label">{t('language')}</label>
                  </div>
                  <Dropdown
                    className="set-dd"
                    value={lang}
                    ariaLabel={t('language')}
                    options={LANG_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
                    onPick={(v) => setLang(v as typeof lang)}
                  />
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <label className="set-field-label">{t('theme')}</label>
                  </div>
                  <Dropdown
                    className="set-dd"
                    value={theme}
                    ariaLabel={t('theme')}
                    options={THEME_OPTIONS.map((opt) => ({
                      value: opt.value,
                      label: t(opt.labelKey),
                    }))}
                    onPick={(v) => applyTheme(v as UiTheme)}
                  />
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <label className="set-field-label">{t('documentTheme')}</label>
                  </div>
                  <Dropdown
                    className="set-dd"
                    value={docTheme}
                    ariaLabel={t('documentTheme')}
                    options={DOC_THEME_OPTIONS.map((opt) => ({
                      value: opt.value,
                      label: t(opt.labelKey),
                    }))}
                    onPick={(v) => applyDocumentTheme(v as DocTheme)}
                  />
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <label className="set-field-label">{t('setAiPanelSide')}</label>
                  </div>
                  <Dropdown
                    className="set-dd"
                    value={aiPrefs.side}
                    ariaLabel={t('setAiPanelSide')}
                    options={[
                      { value: 'left', label: t('aiPanelSideLeft') },
                      { value: 'right', label: t('aiPanelSideRight') },
                    ]}
                    onPick={(side) => updateAiPrefs({ side: side as AiPanelSide })}
                  />
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <label className="set-field-label">{t('setAiFontSize')}</label>
                  </div>
                  {aiPrefs.fontSize === 'custom' && (
                    <CustomFontSizeInput
                      value={aiPrefs.customFontSize}
                      label={t('aiFontSizeCustom')}
                      onCommit={(px) => updateAiPrefs({ customFontSize: px })}
                    />
                  )}
                  <Dropdown
                    className="set-dd"
                    value={aiPrefs.fontSize}
                    ariaLabel={t('setAiFontSize')}
                    options={AI_FONT_SIZE_OPTIONS.map((opt) => ({
                      value: opt.value,
                      label: t(opt.labelKey),
                    }))}
                    onPick={(v) => {
                      const fontSize = v as AiFontSize
                      // start the custom size from the preset being left so nothing jumps
                      updateAiPrefs(
                        fontSize === 'custom' && aiPrefs.fontSize !== 'custom'
                          ? { fontSize, customFontSize: aiPanelFontPx(aiPrefs) }
                          : { fontSize },
                      )
                    }}
                  />
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-stack">
                      <div className="set-field-label">{t('setAiSpellcheck')}</div>
                      <div className="set-field-desc">{t('setAiSpellcheckDesc')}</div>
                    </div>
                  </div>
                  <button
                    className="set-switch"
                    role="switch"
                    aria-checked={aiPrefs.spellcheck}
                    aria-label={t('setAiSpellcheck')}
                    onClick={() => updateAiPrefs({ spellcheck: !aiPrefs.spellcheck })}
                  />
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-stack">
                      <div className="set-field-label">{t('setAiOpenInNewDocs')}</div>
                      <div className="set-field-desc">{t('setAiOpenInNewDocsDesc')}</div>
                    </div>
                  </div>
                  <button
                    className="set-switch"
                    role="switch"
                    aria-checked={aiPrefs.openInNewDocs}
                    aria-label={t('setAiOpenInNewDocs')}
                    onClick={() => updateAiPrefs({ openInNewDocs: !aiPrefs.openInNewDocs })}
                  />
                </div>
                {defaultApp && defaultApp.state !== 'unsupported' && (
                  <div className="set-field">
                    <div className="set-field-text">
                      <div className="set-field-stack">
                        <div className="set-field-label">{t('setDefaultApp')}</div>
                        <div className="set-field-desc">{defaultAppDesc}</div>
                      </div>
                    </div>
                    <button
                      className="set-btn"
                      disabled={defaultAppBusy || defaultApp.state === 'default'}
                      onClick={claimDefaultApp}
                    >
                      {defaultApp.manualOnly
                        ? t('setDefaultAppOpenSettings')
                        : t('setDefaultAppSet')}
                    </button>
                  </div>
                )}
                <Field
                  label={t('saveLocation')}
                  value={saveDir || '—'}
                  valueTitle={saveDir}
                  action={
                    <button className="set-btn" onClick={changeSaveDir}>
                      {t('setChange')}
                    </button>
                  }
                />
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-stack">
                      <div className="set-field-label">{t('setAutoSave')}</div>
                      <div className="set-field-desc">{t('setAutoSaveDesc')}</div>
                    </div>
                  </div>
                  <button
                    className="set-switch"
                    role="switch"
                    aria-checked={autoSaveOn}
                    aria-label={t('setAutoSave')}
                    onClick={() => {
                      const next = !autoSaveOn
                      setAutoSaveOn(next)
                      void window.aiOffice.setAutoSaveDefault?.(next).catch(() => {})
                    }}
                  />
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <div className="set-field-stack">
                      <div className="set-field-label">{t('setAnalytics')}</div>
                      <div className="set-field-desc">{t('setAnalyticsDesc')}</div>
                    </div>
                  </div>
                  <button
                    className="set-switch"
                    role="switch"
                    aria-checked={analyticsOn}
                    aria-label={t('setAnalytics')}
                    disabled={analyticsSaving}
                    onClick={() => {
                      const next = !analyticsOn
                      setAnalyticsSaving(true)
                      void window.aiOffice
                        .setAnalyticsEnabled(next)
                        .then((persisted) => {
                          if (persisted) setAnalyticsOn(next)
                        })
                        .catch(() => {})
                        .finally(() => setAnalyticsSaving(false))
                    }}
                  />
                </div>
              </>
            )}
            {section === 'integrations' && (
              <IntegrationsPane t={t} onStatus={(st) => onSkillUpdateDue?.(skillUpdateDue(st))} />
            )}
            {section === 'about' && (
              <>
                <h3 className="set-pane-title">{t('setSecAbout')}</h3>
                <Field label={t('versionLabel')} value={appVersion || '—'} />
                {updateState && (
                  <div className="set-field">
                    <div className="set-field-text">
                      <label className="set-field-label">{t('setUpdateAvailableLabel')}</label>
                    </div>
                    <button
                      type="button"
                      className="set-update-btn"
                      onClick={() => void window.aiOffice.openUpdateDialog?.()}
                    >
                      {updateState.phase === 'downloading'
                        ? t('setUpdateDownloading', {
                            percent: Math.round(updateState.percent),
                          })
                        : updateState.phase === 'downloaded'
                          ? t('setUpdateRestart')
                          : t('setUpdateTo', { version: updateState.version })}
                    </button>
                  </div>
                )}
                <div className="set-field">
                  <div className="set-field-text">
                    <label className="set-field-label">{t('updateChannel')}</label>
                  </div>
                  <Dropdown
                    className="set-dd"
                    value={channel}
                    ariaLabel={t('updateChannel')}
                    options={CHANNEL_OPTIONS.map((opt) => ({
                      value: opt.value,
                      label: t(opt.labelKey),
                    }))}
                    onPick={(v) => {
                      const next = v === 'beta' ? 'beta' : 'stable'
                      setChannel(next)
                      void window.aiOffice.setUpdateChannel(next)
                    }}
                  />
                </div>
                <Field
                  label={t('setGithub')}
                  value={
                    githubStars === null
                      ? 'github.com/faamoffice/faamoffice'
                      : `github.com/faamoffice/faamoffice · ★ ${formatStars(githubStars)}`
                  }
                  action={
                    <button
                      className="set-btn"
                      onClick={() => void window.aiOffice.openGitHubRepo?.()}
                    >
                      {t('starOnGitHub')}
                    </button>
                  }
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
