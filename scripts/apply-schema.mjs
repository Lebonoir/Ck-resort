import fs from 'fs'
import path from 'path'

const envPath = path.resolve('.env')
const env = Object.fromEntries(
  fs
    .readFileSync(envPath, 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const index = line.indexOf('=')
      return [line.slice(0, index), line.slice(index + 1)]
    }),
)

const sqlPath = path.resolve('supabase/schema.sql')
const password = env.SUPABASE_DB_PASSWORD || env.DATABASE_URL

if (!password) {
  console.log('Paste and run supabase/schema.sql in the Supabase SQL Editor.')
  console.log(`File: ${sqlPath}`)
  console.log('Then restart npm run dev.')
  process.exit(0)
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
await client.query(fs.readFileSync(sqlPath, 'utf8'))
await client.end()
console.log('Schema applied.')
