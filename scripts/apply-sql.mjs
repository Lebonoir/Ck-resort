import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function readProjectEnv(overrides = {}) {
  const envPath = path.join(root, '.env')
  const fromFile = {}
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue
      const index = line.indexOf('=')
      if (index > 0) fromFile[line.slice(0, index)] = line.slice(index + 1)
    }
  }
  return { ...fromFile, ...overrides }
}

export async function applySqlFile(envInput, relativePath) {
  const env = readProjectEnv(envInput)
  const password = env.SUPABASE_DB_PASSWORD || env.DATABASE_URL
  if (!password) {
    return { applied: false, reason: 'no-password' }
  }

  const { Client } = await import('pg')
  const url = env.VITE_SUPABASE_URL || ''
  const ref = url.replace('https://', '').split('.')[0]
  const connectionString = password.startsWith('postgres')
    ? password
    : `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  await client.query(fs.readFileSync(path.join(root, relativePath), 'utf8'))
  await client.end()
  return { applied: true, file: relativePath }
}
