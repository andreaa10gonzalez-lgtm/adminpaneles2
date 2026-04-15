import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://rpqfzsrmmamfhxxarvvf.supabase.co'
const SUPABASE_KEY = 'sb_publishable_E64BlBT1wwUPfyrX0uxGyQ_oj_ItBCw'  // ← pegá la nueva key acá

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)