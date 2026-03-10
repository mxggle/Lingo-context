const pino = require('pino');
const path = require('path');

const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NODE_ENV === 'production';

let logger;

if (isServerless) {
    // In serverless or production bundled environments, rely on standard stream logging
    // since worker threads or file writes (pino-roll) may not be supported or bundled properly.
    logger = pino({
        level: process.env.LOG_LEVEL || 'info'
    });
} else {
    const logDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
    const logFile = path.join(logDir, 'app.log');

    const transports = [
        {
            target: 'pino-roll',
            options: {
                file: logFile,
                frequency: 'daily',
                size: '100m',
                maxFiles: 30,
                compress: true,
                mkdir: true
            }
        }
    ];

    if (process.env.NODE_ENV !== 'production') {
        transports.push({
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname'
            }
        });
    }

    const transport = pino.transport({
        targets: transports
    });

    logger = pino(transport);
}

module.exports = { logger };
