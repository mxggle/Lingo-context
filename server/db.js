const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// Parse connection string or use default
function parseConnectionString(url) {
    if (!url) {
        return {
            host: 'localhost',
            port: 3306,
            user: 'user',
            password: 'password',
            database: 'LingoContext'
        };
    }

    const regex = /mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/;
    const match = url.match(regex);

    if (match) {
        return {
            host: match[3],
            port: parseInt(match[4]),
            user: match[1],
            password: match[2],
            database: match[5]
        };
    }

    return {
        host: 'localhost',
        port: 3306,
        user: 'user',
        password: 'password',
        database: 'LingoContext'
    };
}

const dbConfig = parseConnectionString(process.env.DATABASE_URL);

const pool = mysql.createPool({
    ...dbConfig,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function initializeDatabase() {
    try {
        const connection = await pool.getConnection();
        try {
            console.log('Connected to MySQL database');
            const schemaPath = path.join(__dirname, 'schema.sql');
            const schema = fs.readFileSync(schemaPath, 'utf8');

            // Split schema by semicolons and execute each statement
            const statements = schema.split(';').filter(stmt => stmt.trim());
            for (const stmt of statements) {
                if (stmt.trim()) {
                    await connection.query(stmt);
                }
            }
            console.log('Database schema initialized');
        } finally {
            connection.release();
        }
    } catch (err) {
        console.error('Error initializing database:', err);
        // Don't exit process, let retry or just log error - user might need to set up DB
    }
}

// Helper to query - returns results in format compatible with pg style
const query = async (text, params) => {
    // Convert PostgreSQL $1, $2 style to ? placeholders
    const mysqlQuery = text.replace(/\$(\d+)/g, '?');
    const [rows, fields] = await pool.query(mysqlQuery, params);

    // Return in format similar to pg for easier migration
    return { rows, fields, rowCount: rows.affectedRows || rows.length };
};

module.exports = {
    pool,
    query,
    initializeDatabase
};
