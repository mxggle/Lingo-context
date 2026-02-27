const path = require('path');
const fs = require('fs');

// Mock mysql2
jest.mock('mysql2/promise', () => {
    const mConnection = {
        query: jest.fn(),
        release: jest.fn()
    };
    const mPool = {
        getConnection: jest.fn().mockResolvedValue(mConnection),
        query: jest.fn()
    };
    return {
        createPool: jest.fn().mockReturnValue(mPool)
    };
});

describe('db.js', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...originalEnv };
        jest.clearAllMocks();

        // Spy on fs to avoid aggressive module caching issues with jest.mock
        const originalReadFileSync = fs.readFileSync;
        jest.spyOn(fs, 'readFileSync').mockImplementation((filepath, ...args) => {
            if (typeof filepath === 'string' && filepath.includes('schema.sql')) {
                return 'CREATE TABLE default_test (id INT);';
            }
            return originalReadFileSync(filepath, ...args);
        });
    });

    afterAll(() => {
        process.env = originalEnv;
        jest.restoreAllMocks();
    });

    describe('parseConnectionString (via module load)', () => {
        it('should use default config when DATABASE_URL is not set', () => {
            delete process.env.DATABASE_URL;
            const mysqlMock = require('mysql2/promise');
            require('../db');
            expect(mysqlMock.createPool).toHaveBeenCalledWith(expect.objectContaining({
                host: 'localhost',
                port: 3306,
                user: 'user',
                password: 'password',
                database: 'LingoContext'
            }));
        });

        it('should parse valid DATABASE_URL', () => {
            process.env.DATABASE_URL = 'mysql://admin:secretPass123!@db.example.com:3307/my_db';
            const mysqlMock = require('mysql2/promise');
            require('../db');
            expect(mysqlMock.createPool).toHaveBeenCalledWith(expect.objectContaining({
                host: 'db.example.com',
                port: 3307,
                user: 'admin',
                password: 'secretPass123!',
                database: 'my_db'
            }));
        });

        it('should use defaults if regex fails to match', () => {
            process.env.DATABASE_URL = 'invalid-url-format';
            const mysqlMock = require('mysql2/promise');

            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
            require('../db');

            expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to parse DATABASE_URL — using defaults');
            expect(mysqlMock.createPool).toHaveBeenCalledWith(expect.objectContaining({
                host: 'localhost',
                database: 'LingoContext'
            }));
            consoleErrorSpy.mockRestore();
        });
    });

    describe('initializeDatabase', () => {
        it('should initialize schema successfully', async () => {
            process.env.DATABASE_URL = 'mysql://user:pass@localhost:3306/db';
            const db = require('../db');

            const originalReadFileSync = fs.readFileSync;
            jest.spyOn(fs, 'readFileSync').mockImplementation((filepath, ...args) => {
                if (typeof filepath === 'string' && filepath.includes('schema.sql')) {
                    return 'CREATE TABLE test (id INT); INSERT INTO test VALUES (1);';
                }
                return originalReadFileSync(filepath, ...args);
            });
            const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => { });

            await db.initializeDatabase();

            const connection = await db.pool.getConnection();

            expect(fs.readFileSync).toHaveBeenCalledWith(expect.stringContaining('schema.sql'), 'utf8');
            expect(connection.query).toHaveBeenCalledTimes(2);
            expect(connection.query).toHaveBeenNthCalledWith(1, 'CREATE TABLE test (id INT)');
            expect(connection.query).toHaveBeenNthCalledWith(2, expect.stringContaining('INSERT INTO test VALUES (1)'));
            expect(connection.release).toHaveBeenCalled();

            consoleLogSpy.mockRestore();
        });

        it('should handle and log database initialization errors', async () => {
            const db = require('../db');

            const error = new Error('Connection failed');
            db.pool.getConnection.mockRejectedValueOnce(error);

            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

            await db.initializeDatabase();

            expect(consoleErrorSpy).toHaveBeenCalledWith('Error initializing database:', error);
            consoleErrorSpy.mockRestore();
        });
    });

    describe('query', () => {
        it('should replace PostgreSQL placeholders with MySQL placeholders and format results', async () => {
            const db = require('../db');

            const mockRows = [{ id: 1 }];
            const mockFields = ['field1'];
            db.pool.query.mockResolvedValueOnce([mockRows, mockFields]);

            const result1 = await db.query('SELECT * FROM users WHERE id = $1 AND name = $2', [1, 'John']);

            expect(db.pool.query).toHaveBeenCalledWith('SELECT * FROM users WHERE id = ? AND name = ?', [1, 'John']);
            expect(result1).toEqual({
                rows: mockRows,
                fields: mockFields,
                rowCount: 1
            });

            const mockRowsWithAffected = [];
            mockRowsWithAffected.affectedRows = 2; // mimic mysql2 Result

            db.pool.query.mockResolvedValueOnce([mockRowsWithAffected, mockFields]);
            const result2 = await db.query('UPDATE users SET name = $1', ['Jane']);
            expect(result2.rowCount).toBe(2);
        });
    });
});
