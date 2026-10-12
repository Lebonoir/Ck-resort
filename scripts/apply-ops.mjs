import { applySqlFile } from './apply-sql.mjs'

const password = process.env.SUPABASE_DB_PASSWORD || process.env.DATABASE_URL
const files = ['supabase/resort_ops.sql']

if (!password) {
  console.log('Run this in the Supabase SQL Editor (after every other file in supabase/):')
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
