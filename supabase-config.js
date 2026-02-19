import { createClient } from '@supabase/supabase-js';

// Set up your Supabase URL and API Key here
const supabaseUrl = 'https://your-project.supabase.co';
const supabaseKey = 'your-anon-key';

// Initialize the Supabase client
const supabase = createClient(supabaseUrl, supabaseKey);

export default supabase;