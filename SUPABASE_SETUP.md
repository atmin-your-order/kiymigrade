# SUPABASE_SETUP.md

## SQL Schema for Table Creation

### Users Table
```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Products Table
```sql
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Panels Table
```sql
CREATE TABLE panels (
    id SERIAL PRIMARY KEY,
    title VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Transactions Table
```sql
CREATE TABLE transactions (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id),
    product_id INT REFERENCES products(id),
    amount DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Visitors Table
```sql
CREATE TABLE visitors (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(50) NOT NULL,
    visited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Notifications Table
```sql
CREATE TABLE notifications (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id),
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Step-by-Step Setup Instructions for Supabase Migration
1. **Sign up for Supabase**: Go to the [Supabase website](https://supabase.com/) and create an account if you do not have one.
2. **Create a New Project**: After logging in, create a new project in the Supabase dashboard.
3. **Access the SQL Editor**: Navigate to the SQL editor in the Supabase dashboard. This is where you can run SQL commands to create tables.
4. **Run the SQL Schema**: Copy the SQL schema provided above and paste it into the SQL editor. Execute the commands to create the tables in your Supabase project.
5. **Setup Migrations**: To set up migrations, you may use the Supabase CLI. Install it following the instructions in the Supabase documentation.
6. **Initialize Migrations**: From your local terminal, navigate to your project directory and run `supabase start` to initialize migrations.
7. **Apply Migrations**: Create migration files that reflect your database schema and apply them using the Supabase CLI.
8. **Test the Setup**: Ensure your tables are created successfully and test inserting and querying data using the Supabase dashboard or your application code.

---