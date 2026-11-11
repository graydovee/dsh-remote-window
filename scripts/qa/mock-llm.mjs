#!/usr/bin/env node
/**
 * QA fixture: run @deepseek-ai/dsh-llm-mock-server (the official Messages
 * fault server) and capture evidence.
 *
 * This replaces ONLY the model HTTP endpoint. The DSH agent loop, tool
 * execution and the server-side session log stay real. Never point this at a
 * real credential; the key below is a fixture string.
 *
 * Env:
 *   QA_MOCK_PORT              bind port on 127.0.0.1 (default 28080)
 *   QA_MOCK_HOST              bind host (default 127.0.0.1)
 *   QA_MOCK_API_KEY           expected x-api-key (default qa-mock-key)
 *   QA_MOCK_SEQUENCE          comma list of behaviors (default tool_call_success,success)
 *   QA_MOCK_REPEAT_LAST       "0" disables repeat-last (default repeat)
 *   QA_MOCK_TEXT              success text
 *   QA_MOCK_TOOL_NAME         tool name for tool_call_success (default bash)
 *   QA_MOCK_TOOL_ARGUMENTS    raw JSON arguments string for the tool call
 *   QA_MOCK_DIR               evidence directory (default /home/tester/qa-mock)
 *   QA_MOCK_LOG               JSONL event log (default $QA_MOCK_DIR/requests.jsonl)
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'

const port = Number(process.env.QA_MOCK_PORT ?? '28080')
const host = process.env.QA_MOCK_HOST ?? '127.0.0.1'
const apiKey = process.env.QA_MOCK_API_KEY ?? 'qa-mock-key'
const dir = process.env.QA_MOCK_DIR ?? '/home/tester/qa-mock'
const logPath = process.env.QA_MOCK_LOG ?? join(dir, 'requests.jsonl')
const sequence = (process.env.QA_MOCK_SEQUENCE ?? 'tool_call_success,success')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean)
const repeatLast = process.env.QA_MOCK_REPEAT_LAST !== '0'
const successText = process.env.QA_MOCK_TEXT
  ?? 'QA mock model reply: the real DSH agent loop completed this server-side turn.'
const toolName = process.env.QA_MOCK_TOOL_NAME ?? 'bash'
const toolArguments = process.env.QA_MOCK_TOOL_ARGUMENTS
  || JSON.stringify({
    description: 'Write QA marker file',
    command: "printf '%s\\n' 'dsh-remote-workspace QA server baseline' > qa-marker.txt && pwd && cat qa-marker.txt",
  })

mkdirSync(dir, { recursive: true })

function record(event) {
  try {
    appendFileSync(logPath, `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`)
  } catch {
    // Evidence logging must not change wire behavior.
  }
}

/** @type {import('@deepseek-ai/dsh-llm-mock-server').MockLlmServer | undefined} */
let server
server = await startMockLlmServer({
  host,
  port,
  apiKey,
  sequence,
  repeatLast,
  successText,
  toolName,
  toolArguments,
  onEvent(event) {
    record(event)
    if (event.type !== 'result') return
    const last = server?.requests.at(-1)
    if (last === undefined || last.attempt !== event.attempt) return
    try {
      writeFileSync(join(dir, `attempt-${last.attempt}.json`), `${JSON.stringify(last, null, 2)}\n`)
    } catch {
      // ignore evidence write failures
    }
  },
})

const ready = {
  ready: true,
  pid: process.pid,
  baseURL: server.baseURL,
  port: server.port,
  sequence,
  repeatLast,
  toolName,
  apiKeyFixture: apiKey,
}
writeFileSync(join(dir, 'ready.json'), `${JSON.stringify(ready, null, 2)}\n`)
console.log(JSON.stringify(ready))

async function shutdown() {
  try {
    await server?.close()
  } finally {
    process.exit(0)
  }
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
// Keep the event loop alive after the listener is created.
setInterval(() => {}, 1 << 30)
