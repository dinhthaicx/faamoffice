import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The one-shot `ai:chat` handlers (docs-main serves it inside the shell, where
 * Settings → AI "Test" calls it; sheets-main when Sheets runs standalone) must
 * show Faam AI Cloud's refusals in the UI language, not the server's English
 * text. Their locale tables are inline objects handed to createI18n, so they
 * are read out of the source, like main-locale-tables.test.ts does.
 */
const root = join(__dirname, '../../..')
const MAIN_FILES = ['apps/docs/src/main/docs-main.ts', 'apps/sheets/src/main/sheets-main.ts']
const LOCALES = [
  'zh',
  'en',
  'vi',
  'ja',
  'ko',
  'fr',
  'de',
  'es',
  'th',
  'id',
  'ru',
  'ar',
  'pt',
  'it',
  'pl',
  'cs',
  'nl',
  'ms',
  'he',
  'hi',
  "'zh-TW'",
]

/** one locale's slice of the main table, from its `xx: {` header to the next one */
function localeBlock(source: string, locale: string): string {
  const start = source.search(new RegExp(`\\n {2}${locale}: \\{`))
  if (start < 0) throw new Error(`no ${locale} block in the main-process locale table`)
  const rest = source.slice(start + 1)
  const end = rest.search(/\n {2}\S+: \{/)
  return end < 0 ? rest : rest.slice(0, end)
}

function creditsText(source: string, locale: string): string {
  const value = localeBlock(source, locale).match(/\n {4}errFaamCredits:\s*(?:'([^']*)'|"([^"]*)")/)
  if (!value) throw new Error(`no errFaamCredits in the ${locale} block`)
  return value[1] ?? value[2]!
}

/** the body of the `ai:chat` handler, up to the next handler */
function chatHandler(source: string): string {
  const start = source.search(/ipcMain\.handle\((?:'ai:chat'|IPC_CHANNELS\.aiChat),/)
  if (start < 0) throw new Error('no ai:chat handler')
  const rest = source.slice(start)
  const end = rest.indexOf('\n  })\n')
  return end < 0 ? rest : rest.slice(0, end)
}

describe.each(MAIN_FILES)('%s one-shot AI errors', (file) => {
  const source = readFileSync(join(root, file), 'utf8')

  it('has an out-of-credits message in every locale, translated', () => {
    const texts = LOCALES.map((locale) => creditsText(source, locale))
    for (const text of texts) expect(text).toMatch(/Faam[ -]AI/)
    expect(texts[1]).toBe('Your Faam AI credits are used up. Ask an administrator to add more')
    expect(texts[2]).toBe('Bạn đã dùng hết credit Faam AI. Hãy nhờ quản trị viên nạp thêm')
    // only zh and zh-TW share a script, and even they differ
    expect(new Set(texts).size).toBe(LOCALES.length)
  })

  it('maps credits, daily-limit and busy failures to the localized messages', () => {
    const handler = chatHandler(source)
    expect(handler).toMatch(/return localizeChatFailure\(result, \{/)
    expect(handler).toMatch(/credits: \(\) => tm\('errFaamCredits'\)/)
    expect(handler).toMatch(/dailyLimit: faamDailyLimitText/)
    expect(handler).toMatch(/busy: \(\) => tm\('errAiBusy'\)/)
    // no raw pass-through of the server's text is left
    expect(handler).not.toMatch(/\n {6}return result\n/)
  })
})
