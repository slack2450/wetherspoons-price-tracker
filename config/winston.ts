'use strict';
/*
    winston.ts
    slimsoma.co.uk
    Copyright 2021
    Creates and configures Winston logger
*/

/*
    Module dependencies.
*/

import winston from 'winston';

/*
    Setup Winston logging
*/

// setup transports
let transports: winston.transport[] = [
    new winston.transports.File({
        filename: 'error.log',
        level: 'error',
        format: winston.format.uncolorize(),
    }), // error logs only
    new winston.transports.File({
        filename: 'combined.log',
        format: winston.format.uncolorize(),
    }), // combined log
];

// Enable debug only when in development
if (process.env.NODE_ENV && process.env.NODE_ENV.toLowerCase() == 'development')
    transports.push(new winston.transports.Console({ level: 'debug' }));

// export logger
const logger : winston.Logger = winston.createLogger({
    format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'YYYY-MM-DD hh:mm:ss' }),
        winston.format.align(),
        winston.format.printf(
            (info) => `[${info.timestamp}] [${info.level}] ${info.message}`
        )
    ),
    level: process.env.LOG_LEVEL || 'info',
    transports: transports,
});

export default logger;