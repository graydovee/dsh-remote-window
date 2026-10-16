/**
 * The locale seat for the vendored rows.
 *
 * The vendored components translate through the `workspace` namespace
 * dictionaries copied from the shell (`generated/locales.ts`), so their wording
 * — 新会话 / 未命名 / 刚刚 / 重命名 … — is byte-identical to the shell's own rows
 * instead of a paraphrase. The active language follows this plugin's switch.
 */
import { getLocale } from '../../locales.ts'
import { en, zh } from './generated/locales.ts'
import type { RowsTranslate } from './models.ts'

/**
 * Translate one vendored row key.
 * @param key - `workspace` namespace key.
 * @param params - `{name}` values; an unknown name keeps its placeholder.
 * @returns the localized string (falls back to the key when the copy is absent).
 */
export const rowsTranslate: RowsTranslate = (key, params) => {
  const table: Record<string, string> = getLocale() === 'en' ? en : zh
  const template = table[key] ?? key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match: string, name: string) => {
    const value = params[name]
    return value === undefined || value === null ? match : String(value)
  })
}
