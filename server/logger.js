const pino = require('pino');
const path = require('path');

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

const logger = pino(transport);

module.exports = { logger };
