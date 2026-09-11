import { applySqlFile } from './apply-sql.mjs'

const password = process.env.SUPABASE_DB_PASSWORD || process.env.DATABASE_URL
const files = ['supabase/system_backup.sql']

if (!password) {
  console.log('Run this in the Supabase SQL Editor:')
  for (const file of files) console.log(`- ${file}`)
  process.exit(0)
}

for (const file of files) {
  const result = await applySqlFile(process.env, file)
  if (!result.applied) {
    console.error(result.reason || `Could not apply ${file}.`)
    process.exit(1)
  }
  console.log(`Applied ${file}`)
}
