// Separate file just for testing the startup crash behavior to avoid polluting the main index.js tests
// which need a healthy Express setup.

jest.mock('dotenv', () => ({ config: jest.fn() }));

describe('Server Startup Validation', () => {
    let originalEnv;
    let originalExit;

    beforeEach(() => {
        jest.resetModules();
        originalEnv = process.env;
        process.env = { ...originalEnv };

        originalExit = process.exit;
        process.exit = jest.fn();

        jest.spyOn(console, 'error').mockImplementation(() => { });
    });

    afterEach(() => {
        process.env = originalEnv;
        process.exit = originalExit;
        console.error.mockRestore();
    });

    it('should fatal exit if production and no SESSION_SECRET', () => {
        process.env.NODE_ENV = 'production';
        delete process.env.SESSION_SECRET;

        const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit called'); });

        // Mock db so it doesn't try to actually connect
        jest.mock('../db', () => ({ pool: {}, initializeDatabase: jest.fn() }));
        jest.mock('../auth', () => ({
            initialize: () => (req, res, next) => next(),
            session: () => (req, res, next) => next(),
            authenticate: jest.fn(() => (req, res, next) => next())
        }));


        try {
            require('../index');
        } catch (e) {
            // Catch the mocked process.exit throw
        }

        expect(console.error).toHaveBeenCalledWith('FATAL: SESSION_SECRET environment variable is required in production');
        expect(exitSpy).toHaveBeenCalledWith(1);

        exitSpy.mockRestore();
    });
});
