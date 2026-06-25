require('dotenv').config()
const winston = require('winston')
const express = require('express')
const path = require('path')
const ical = require('ical-generator')
const cron = require('node-cron')
const cors = require('cors')
const Database = require('better-sqlite3')
const fileUpload = require('express-fileupload')
const fs = require('fs')
require('winston-daily-rotate-file')
const multer = require('multer')
const session = require('express-session');

const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROK_API_KEY });

const startupTime = new Date().toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-');

const {
    generateBasicAuth,
    generateSignature,
    formatDate,
    getDaysBetween,
    convertDateString,
} = require('./helper')




const combinedRotateTransport = new winston.transports.DailyRotateFile({
    filename: `logs/combined-%DATE%-${startupTime}.log`,
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true, // Compress old logs to save space
    maxSize: '20m',      // Rotate if file exceeds 20mb (even if same day)
    maxFiles: '14d'      // Delete logs older than 14 days
});

const errorRotateTransport = new winston.transports.DailyRotateFile({
    filename: `logs/error-%DATE%-${startupTime}.log`,
    datePattern: 'YYYY-MM-DD',
    level: 'error',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '30d'
});

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.json()
    ),
    transports: [
        errorRotateTransport,
        combinedRotateTransport
    ]
});

const {
    refreshAuthToken,
    getToken
} = require('./tokens')(logger)

const {
    sendBookingConfirmation
} = require('./mail')(logger)
const {
    renderIndex,
    renderBook,
    renderFaq,
    renderAmenities,
    renderNotice,
    renderBlog
} = require('./render')(logger)

if (process.env.NODE_ENV != 'production') {
    console.log('dev mode')
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.prettyPrint(),
            winston.format.colorize()
        )
    }))
}


const app = express()
const port = 4444


app.use(express.static(path.join(__dirname, 'public'), { index: false }))

let db = null;
try {
    db = new Database('./kozarapanoramicresort.db');
} catch (e) {
    logger.error("Failed to connect to database: " + e.message);
}

require('./routes')(app, {
    logger,
    getToken,
    db,
    generateBasicAuth,
    generateSignature,
    formatDate,
    sendBookingConfirmation,
    getDaysBetween,
    convertDateString,
    renderIndex,
    renderBook,
    renderFaq,
    renderAmenities,
    renderNotice,
    renderBlog
});

app.listen(port, async () => {
    try {
        console.log("app listening on ", port)
    } catch (error) {
        logger.error(error)

    }

    try {
        await refreshAuthToken()
    } catch (e) {
        logger.error("Failed to refresh auth token: " + e.message);
    }

})
