const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = 'YOUR_SUPABASE_URL'; // Replace with your Supabase URL
const supabaseKey = 'YOUR_SUPABASE_KEY'; // Replace with your Supabase key
const supabase = createClient(supabaseUrl, supabaseKey);

// Function to read data from JSON files
const readJSONFile = (filePath) => {
    const data = fs.readFileSync(filePath);
    return JSON.parse(data);
};

// Migration function
const migrateData = async () => {
    try {
        // Read JSON data
        const users = readJSONFile('users.json');
        const products = readJSONFile('products.json');
        const database = readJSONFile('database.json');
        const visitors = readJSONFile('visitors.json');
        const panels = readJSONFile('panels.json');

        // Insert users
        const { data: userData, error: userError } = await supabase.from('users').insert(users);
        if (userError) throw userError;

        // Insert products
        const { data: productData, error: productError } = await supabase.from('products').insert(products);
        if (productError) throw productError;

        // Insert database entries
        const { data: databaseData, error: databaseError } = await supabase.from('database').insert(database);
        if (databaseError) throw databaseError;

        // Insert visitors
        const { data: visitorData, error: visitorError } = await supabase.from('visitors').insert(visitors);
        if (visitorError) throw visitorError;

        // Insert panels
        const { data: panelData, error: panelError } = await supabase.from('panels').insert(panels);
        if (panelError) throw panelError;

        console.log('Migration completed successfully!');

    } catch (error) {
        console.error('Error during migration:', error);
    }
};

// Execute migration
migrateData();
