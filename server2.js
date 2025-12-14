
require('dotenv').config()

const crypto = require('crypto')
const winston = require('winston')
const express = require('express')
const path = require('path')
const cron = require('node-cron')
const cors = require('cors')
const Database = require('better-sqlite3')
const fs = require('fs')
const nodemailer = require('nodemailer')
const multer = require('multer')
const { Readable } = require('stream');
const { finished } = require('stream/promises');
const mime = require('mime-types');
const { v4: uuidv4 } = require('uuid');
require('winston-daily-rotate-file')
let db
let tok


const startupTime = new Date().toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-');

// Define the Rotation Transport for Combined logs
const combinedRotateTransport = new winston.transports.DailyRotateFile({
    // Filename pattern: 'logs/combined-2023-11-24_15-30-00.log'
    // The %DATE% handles the daily rotation logic
    filename: `logs/combined-%DATE%-${startupTime}.log`,
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true, // Compress old logs to save space
    maxSize: '20m',      // Rotate if file exceeds 20mb (even if same day)
    maxFiles: '14d'      // Delete logs older than 14 days
});

// Define the Rotation Transport for Error logs
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
    // Use the timestamp inside the log content as well
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.json()
    ),
    transports: [
        errorRotateTransport,
        combinedRotateTransport
    ]
});




if (process.env.NODE_ENV != 'production') {
    console.log('dev mode')
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.prettyPrint(),
            winston.format.colorize()
        )
    }))
}


const uploadDir = './public/uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}
// Set up storage engine
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, 'public/uploads');
        // Create directory if it doesn't exist
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        // Generate unique name: timestamp-originalname
        // e.g. "1702495000000-my-image.jpg"
        const uniqueName = Date.now() + '-' + file.originalname.replace(/\s+/g, '-');
        cb(null, uniqueName);
    }
});

// File filter (Validate Images Only)
const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extName = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimeType = allowedTypes.test(file.mimetype);

    if (extName && mimeType) {
        return cb(null, true);
    } else {
        cb(new Error('Only images are allowed (jpeg, jpg, png, gif)!'));
    }
};

// Initialize Multer
const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // Limit file size to 5MB
    fileFilter: fileFilter
});

function convertDateString(dateStr) {
    // Split the "YY-MM-DD" string
    const [yy, mm, dd] = dateStr.split('-').map(Number);

    // Create a Date object (Assuming 2000s for the year '25')
    // Note: Month is 0-indexed in JS (0 = Jan, 9 = Oct)
    const dateObj = new Date(yy, mm - 1, dd);

    // Format to "Oct 12, 2025"
    return dateObj.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}


function getDaysBetween(date1, date2) {
    const d1 = new Date(date1);
    const d2 = new Date(date2);

    // Reset time to midnight for accurate day calculation
    d1.setHours(0, 0, 0, 0);
    d2.setHours(0, 0, 0, 0);

    const diffTime = Math.abs(d2.getTime() - d1.getTime());

    // Convert milliseconds to days
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}


function formatDate(date) {
    const iso = date.toISOString();
    const datePart = iso.slice(0, 10); // YYYY-MM-DD
    const timePart = iso.slice(11, 19).replace(/:/g, ''); // HHMMSS
    return `${datePart}-${timePart}`;
}


async function sendBookingConfirmation(bookingData) {
    try {
        // Read the HTML template file
        const templatePath = path.join(__dirname, 'email.html');
        let htmlTemplate = fs.readFileSync(templatePath, 'utf8');

        // Replace placeholders with real data
        const replacements = {
            '{{customerName}}': bookingData.customerName,
            '{{bookingId}}': bookingData.id,
            '{{checkInDate}}': bookingData.startDate,
            '{{checkOutDate}}': bookingData.endDate,
            '{{guestsCount}}': `${bookingData.adults} Adults, ${bookingData.children} Children`,
            '{{nightsCount}}': bookingData.nights,
            '{{totalPrice}}': bookingData.totalPrice
        };

        // Simple string replacement
        for (const [key, value] of Object.entries(replacements)) {
            // Using a regex with 'g' flag to replace all occurrences
            htmlTemplate = htmlTemplate.replace(new RegExp(key, 'g'), value);
        }

        // Send mail
        const info = await transporter.sendMail({
            from: '"Kozara Panoramic Resort" <bookings@kozarapanoramicresort.ba>',
            to: bookingData.email,
            subject: `Booking Confirmed: #${bookingData.id}`, // Unique ID prevents threading
            text: `Dear ${bookingData.customerName}, your booking at Kozara Resort is confirmed. Ref: ${bookingData.id}`, // Fallback plain text
            html: htmlTemplate
        });

        console.log("Message sent: %s", info.messageId);
        logger.info({ message: info.messageId })
        return true;

    } catch (error) {
        logger.error({ message: error.message })
        console.error("Error sending email:", error);
        return false;
    }
}




const app = express()

app.use(cors())
const port = 5000
app.use(express.static(path.join(__dirname, 'public')))

const transporter = nodemailer.createTransport({
    // service: 'gmail',
    // auth: {
    //     user: process.env.EMAIL_USER,
    //     pass: process.env.EMAIL_PASSWORD
    // }
    host: 'mail.kozarapanoramicresort.ba',
    port: 465,
    secure: true,
    auth: {
        user: "bookings@kozarapanoramicresort.ba",
        pass: "!Kozarapanoramicresort2025"
    },
    pool: true
});

app.get("/mail", async (req, res) => {
    // try {
    //     const info = await transporter.sendMail({
    //         from: '"Kozara Panoramic Resort" <bookings@kozarapanoramicresort.ba>',
    //         to: "ghfmk9@gmail.com",
    //         subject: `Booking Confirmed`, // Unique ID prevents threading
    //         text: `Test email`, // Fallback plain text
    //     });
    //     logger.info({message: info})
    //     res.status(200).send(info)

    // } catch(error) {
    //     logger.error({message: error.message})
    // }

    try {
        const templatePath = path.join(__dirname, 'email.html');
        let htmlTemplate = fs.readFileSync(templatePath, 'utf8');



        const info = await transporter.sendMail({
            from: '"Kozara Panoramic Resort" <bookings@kozarapanoramicresort.ba>',
            to: "ghfmk9@gmail.com",
            subject: `Booking Confirmed: #00000`, // Unique ID prevents threading
            text: `Dear Customer, your booking at Kozara Resort is confirmed. Ref: #0000`, // Fallback plain text
            html: htmlTemplate
        });

        logger.info({ message: info })
        res.send('OK')

    } catch (error) {
        logger.error({ message: error.message })
        res.status(500)
    }


})



// app.use(express.static(path.join(__dirname, 'public')))

function generateBasicAuth(username, password) {

    const credentials = `${username}:${password}`
    return Buffer.from(credentials).toString('base64')
}


function generateSignature(method, body, contentType, date, requestURI, sharedSecret) {

    const bodyHash = crypto.createHash('sha512').update(body).digest('hex')
    const message = [method, bodyHash, contentType, date, requestURI].join('\n')
    const hmac = crypto.createHmac('sha512', sharedSecret)
    hmac.update(message)
    const signature = hmac.digest('base64')
    return signature
}



async function refreshAuthToken() {

    logger.info('refreshToken method called')

    const tokenRequest = await fetch('https://beds24.com/api/v2/authentication/token', {
        method: 'GET',
        headers: {
            'refreshToken': process.env.BEDS24_REFRESH_TOKEN,
            'Accept': 'application/json'
        }
    })


    if (tokenRequest.ok) {
        const tokenResponse = await tokenRequest.json()
        tok = tokenResponse.token
        logger.info('token generated successfully')
    }

}

function findAvailableUnits(dailyStatus) {
    const unitIds = ['1', '2', '3', '4', '5']

    const unitAvailabilityTracker = {
        '1': true,
        '2': true,
        '3': true,
        '4': true,
        '5': true
    }



    //iterating through the data from beds24
    for (const date in dailyStatus) {

        if (Object.prototype.hasOwnProperty.call(dailyStatus, date)) {
            const dayUnits = dailyStatus[date]

            for (const unitId of unitIds) {
                if (dayUnits[unitId] === 1) {
                    unitAvailabilityTracker[unitId] = false;
                }
            }
        }
    }


    const availableUnits = []
    for (const unitId in unitAvailabilityTracker) {
        if (unitAvailabilityTracker[unitId] === true) {
            availableUnits.push(Number.parseInt(unitId))
        }
    }

    return availableUnits
}

// app.get('/preview2', (req, res) => {
//     res.sendFile(path.join(__dirname, 'public', 'index.html'))
// })

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'))
})
app.get('/sr', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'))
})
app.get('/de', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'))
})
app.get('/en', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'))
})
app.get('/it', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.get('/notice', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'notice.html'))
})
app.get('/notice/sr', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'notice.html'))
})
app.get('/notice/de', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'notice.html'))
})
app.get('/notice/en', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'notice.html'))
})
app.get('/notice/it', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'notice.html'))
})

app.get("/langpack/:id", (req, res) => {
    console.log('language endpoitn called')
    const langId = req.params.id

    if (!langId) {
        console.log('no lang id')
        res.status(400).json({ message: 'no parameter' })
        return
    }


    fs.readFile("languages/" + langId + ".json", 'utf-8', (err, data) => {
        if (err) {
            console.log(err)
            res.status(500).json({ message: "failed to read file!" })
            return
        }
        console.log('no error')


        try {
            const jsonData = JSON.parse(data)

            res.json(jsonData)

        } catch (error) {
            res.status(500)

        }
    })
})





app.get('/booking/check-payment', (req, res) => {
    const transactionId = req.query.tid;

    if (!transactionId) {
        return res.redirect('/error');
    }

    try {
        // Look up the booking using the Transaction ID (uniqueId)
        const booking = db.prepare('SELECT bookingId FROM bookings WHERE bookingTransactionId = ?').get(transactionId);

        if (booking && booking.bookingId) {
            // Found it! Redirect to the nice display page using the Real Booking ID
            res.redirect(`/booking/success/${booking.bookingId}`);
        } else {
            // Payment might be successful, but DB insert hasn't finished or failed
            logger.error(`Booking not found for transaction ${transactionId}`);
            res.redirect('/error?msg=booking_not_found');
        }
    } catch (error) {
        logger.error(error.message);
        res.redirect('/error');
    }
});


app.get('/booking/success/:id', (req, res) => {
    const bookingId = req.params.id;

    try {
        // 1. Fetch full details from DB using the Beds24 Booking ID
        const bookingData = db.prepare('SELECT * FROM bookings WHERE bookingId = ?').get(bookingId);

        if (!bookingData) {
            return res.status(404).send("Booking not found");
        }

        // 2. Read the HTML Template
        const templatePath = path.join(__dirname, 'public', 'success.html');
        let htmlPage = fs.readFileSync(templatePath, 'utf8');

        // 3. Replacements
        const replacements = {
            '{{customerName}}': bookingData.customerName,
            '{{bookingId}}': bookingData.bookingId,
            '{{email}}': bookingData.customerEmail,
            '{{checkInDate}}': convertDateString(bookingData.startDate),
            '{{checkOutDate}}': convertDateString(bookingData.endDate),
            '{{guestsCount}}': `${bookingData.adults} Adults, ${bookingData.children} Children`,
            '{{price}}': bookingData.price
        };

        for (const [key, value] of Object.entries(replacements)) {
            htmlPage = htmlPage.replace(new RegExp(key, 'g'), value);
        }

        res.send(htmlPage);

    } catch (error) {
        logger.error("Error serving success page: " + error.message);
        res.status(500).send("Error generating confirmation page.");
    }
});





app.get('/api/availability', async (req, res) => {
    logger.info('api/availability called')

    const startDate = req.query.startDate
    const endDate = req.query.endDate

    if (!startDate || !endDate) {
        res.status(400).json({
            success: false,
            message: 'Please provide both startDate and endDate in the query string.'
        });
        return
    }
    let availabilityResponse
    let success
    let attempt = 0

    while (attempt < 2) {
        try {

            const availabilityRequest = await fetch(`https://beds24.com/api/v2/inventory/rooms/unitBookings?startDate=${startDate}&endDate=${endDate}`, {
                method: 'GET',
                headers: {
                    'token': tok,
                    'Accept': 'appliation/json'
                }
            })
            availabilityResponse = await availabilityRequest.json()
            if (availabilityResponse.success) {
                success = true
                break
            }

            if (availabilityResponse.code === 401) {
                logger.warn('Beds24 token expired, trying to refresh...')
                await refreshAuthToken()
                attempt++
            }


            if (attempt === 1) {
                continue
            }
            break

        } catch (error) {
            logger.error(error.message)
            res.json({ success: false, message: 'Error while communicating with the channel manager! Please try again later.' })

        }
    }

    if (success) {
        const unitBookings = availabilityResponse.data[0].unitBookings
        const availableUnits = findAvailableUnits(unitBookings)
        logger.info({ message: 'Available units: ', units: availableUnits })
        res.status(200).json({ success: true, availableUnits })
    } else {
        logger.error(`Beds24 request failed after ${attempt} attempts.`);
        res.status(500).json({ success: false, message: 'Network or unexpected error!' })
    }
})



app.get('/api/getprices', async (req, res) => {

    logger.info('api/getprices called')

    const startDate = req.query.startDate
    const endDate = req.query.endDate
    if (!startDate || !endDate) {
        return res.status(400).json({
            error: 'Missing required parameters.',
            details: 'Please provide both startDate and endDate in the query string.'
        });
    }


    let pricesResponse
    let attempt = 0
    let success


    try {
        while (attempt < 2) {
            const pricesRequest = await fetch(`https://beds24.com/api/v2/inventory/rooms/calendar?startDate=${startDate}&endDate=${endDate}&includePrices=true&includeNumAvail=true`, {
                method: 'GET',
                headers: {
                    'token': tok,
                    'Accept': 'application/json'
                }
            })

            pricesResponse = await pricesRequest.json()
            logger.info(pricesResponse)
            if (pricesResponse.success) {
                success = true
                break
            }


            if (pricesResponse.code === 401) {
                logger.warn('Beds24 token expired, trying to refresh...')
                await refreshAuthToken()
                attempt++
            }

            if (attempt === 1) {
                continue
            }
            break
        }

        if (success) {
            res.json(pricesResponse.data[0].calendar)
        } else {
            logger.error(`Beds24 request failed after ${attempt} attempts.`);
            res.status(500).json({ success: false, message: 'Network or unexpected error!' })
        }






    } catch (error) {
        logger.error(error)
        res.send(500).json({
            success: false,
            message: 'Error while communicating with the channel manager'
        })
        return
    }
})



app.post('/api/booking', express.json(), async (req, res) => {

    logger.info('/api/booking called')
    //generate payment uniqueId
    const date = new Date()
    const uniqueId = formatDate(date)


    //checking room availaiblity for set of dates
    const availabilityParams = new URLSearchParams({
        startDate: req.body.startDate,
        endDate: req.body.endDate
    })



    let availiabilityData;
    let availabilitySuccess
    let availabilityAttempt = 0

    while (availabilityAttempt < 2) {
        try {
            const availiabilityRequest = await fetch(`https://beds24.com/api/v2/inventory/rooms/availability?${availabilityParams}`, {
                method: 'GET',
                headers: {
                    'token': tok,
                    'Accept': 'application/json'
                }
            })

            availiabilityData = await availiabilityRequest.json()


            if (availiabilityData.success) {
                availabilitySuccess = true
                logger.info('availability check was a success')
                break
            }


            if (availiabilityData.code === 401) {

                logger.warn('Beds24 token expired, trying to refresh...')
                await refreshAuthToken()
                availabilityAttempt++
            }

            if (availabilityAttempt === 1) {
                continue
            }
            break


        } catch (error) {
            logger.error(error.message)
            res.json({ success: false, message: 'Error while communicating with the channel manager! Pleae try again later.' })
            return
        }
    }



    if (availabilitySuccess) {
        logger.info('availability check was a success')

        const availabilityObject = availiabilityData.data[0].availability;
        const availabilityEntries = Object.entries(availabilityObject);
        const totalDays = availabilityEntries.length;
        if (totalDays === 0) {
            logger.info(`No chalets were available from ${req.body.startDate} - ${req.body.endDate}`)
            res.status(400).json({ success: false, message: 'No chalets are available for that set of dates!' })
            return
        }

        const isPatternCorrect = availabilityEntries.every(([date, isAvailable], index) => {
            return isAvailable === true;
        });
        if (!isPatternCorrect) {
            logger.info(`No chalets were available from ${req.body.startDate} - ${req.body.endDate}`)
            res.status(400).json({ success: false, message: 'No chalets are available for that set of dates!' })
            return
        }





        //at this point the room is available and we make an offer
        const offerParams = new URLSearchParams({

            arrival: req.body.startDate,
            departure: req.body.endDate,
            numAdults: req.body.numAdults,
            numChildren: req.body.numChildren,
        })
        try {

            const offerResponse = await fetch(`https://beds24.com/api/v2/inventory/rooms/offers?${offerParams}`, {
                method: 'GET',
                headers: {
                    'token': tok,
                    'Accept': 'application/json'
                }
            })

            const offerData = await offerResponse.json()
            console.log(offerData.data[0].offers[0])
            const price = offerData.data[0].offers[0].price

            if (offerData.success) {
                logger.info('Offer from beds24 is a success')

                const requestBodyPayment = {
                    merchantTransactionId: uniqueId,
                    amount: `${price}`, errorUrl: `${process.env.BASE_URL}/error?type=payment`, successUrl: `${process.env.BASE_URL}/booking/check-payment?tid=${uniqueId}`, callbackUrl: `${process.env.BASE_URL}/api/callback`, currency: "BAM",
                    customer: {
                        billingAddress1: req.body.billingAddress,
                        billingCity: req.body.billingCity,
                        billingCountry: req.body.billingCountry,
                        billingPostcode: req.body.billingPostCode,
                        email: req.body.customerEmail,
                        firstName: req.body.customerName,
                        lastName: req.body.customerLastName

                    },
                    description: `Booking payment for ${req.body.customerName} ${req.body.customerLastName}`
                }

                const paymentRequestMethod = 'POST'
                const paymentRequestURI = `/api/v3/transaction/${process.env.API_KEY}/debit`
                const paymentRequestContentType = 'application/json; charset=utf-8'
                const paymentRequestJsonBody = JSON.stringify(requestBodyPayment)

                const paymentRequestBasicAuth = generateBasicAuth(process.env.USERNAME, process.env.PASSWORD)
                const paymentRequestSignature = generateSignature(paymentRequestMethod, paymentRequestJsonBody, paymentRequestContentType, date.toUTCString(), paymentRequestURI, process.env.SHARED_SECRET)

                const paymentRequestHeaders = {
                    'Content-Type': paymentRequestContentType,
                    'Date': date.toUTCString(),
                    'Authorization': `Basic ${paymentRequestBasicAuth}`,
                    'Accept': 'application/json',
                    'X-Signature': paymentRequestSignature
                };


                let paymentResponseData
                try {

                    const paymentRequest = await fetch(`https://gateway.bankart.si/api/v3/transaction/${process.env.API_KEY}/debit`, {
                        method: paymentRequestMethod,
                        headers: paymentRequestHeaders,
                        body: paymentRequestJsonBody
                    })

                    paymentResponseData = await paymentRequest.json()

                    const insertBooking = db.prepare(`INSERT INTO bookings (customerName, customerLastName, customerEmail, customerPhone, billingAddress, billingCity, billingCountry, billingPostCode, startDate, endDate, bookingId, bookingStatus, bookingTransactionId, createdAt, adults, children, price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);


                    if (paymentResponseData.success) {
                        logger.info('Payment was generated successfully')


                        const requestBookingBody = [{
                            roomId: process.env.ROOM_ID,
                            arrival: req.body.startDate,
                            departure: req.body.endDate,
                            firstName: req.body.customerName,
                            lastName: req.body.customerLastName,
                            email: req.body.customerEmail,
                            phone: req.body.customerPhone,
                            address: req.body.billingAddress,
                            city: req.body.billingCity,
                            postcode: req.body.billingPostCode,
                            country: req.body.billingCountry,
                            numAdult: req.body.numAdults,
                            numChild: req.body.numChildren,
                            status: 'request'
                        }]

                        const bookingRequest = await fetch('https://beds24.com/api/v2/bookings', {
                            method: 'POST',
                            headers: {
                                'token': tok,
                                'Accept': 'application/json'
                            },
                            body: JSON.stringify(requestBookingBody)
                        })

                        const bookingResponse = await bookingRequest.json()
                        logger.info({ message: bookingResponse[0] })

                        if (bookingResponse[0].success) {
                            logger.info('Booking is created successfylly on Beds24, proceeding to insert into database')


                            try {
                                logger.info({ message: 'inserting into database...' })
                                const insertBookingResult = insertBooking.run(req.body.customerName, req.body.customerLastName, req.body.customerEmail, req.body.customerPhone, req.body.billingAddress, req.body.billingCity, req.body.billingCountry, req.body.billingPostCode, req.body.startDate, req.body.endDate, bookingResponse[0].new.id.toString(), process.env.PAYMENT_PENDING, uniqueId, Date.now(), Number.parseInt(req.body.numAdults), Number.parseInt(req.body.numChildren), price)

                                logger.info({ message: insertBookingResult })

                            } catch (error) {
                                console.error("Error during database insert:", error);
                                logger.error(error.message)
                            }

                        }
                    }

                } catch (error) {
                    logger.error(error.message)

                }

                res.json({
                    success: true,
                    url: paymentResponseData.redirectUrl
                })

            }

        } catch (error) {
            logger.error(error.message)
            res.json({ success: false, message: 'Error while communicating with the channel manager! Please try again later.', details: error.message })
        }



    }
})

app.get('/refresh', async (req, res) => {
    logger.info('refresh api called')

    // await refreshAuthToken()
    res.status(200).send('OK')
})


app.post("/api/callback", express.json(), async (req, res) => {
    logger.info('/api/callback is called')
    res.status(200).send('OK')


    if (req.body.result === 'OK') {
        logger.info('Payment was a succss')

        const updateBookingPrepare = db.prepare(`UPDATE bookings SET bookingStatus = ? WHERE bookingtransactionId = ?`)
        const getBookingPrepare = db.prepare(`SELECT * FROM bookings WHERE bookingTransactionID = ?`)

        let booking
        try {

            //retrieve the booking in question
            booking = getBookingPrepare.get(req.body.merchantTransactionId)


            //update the booking in question on Beds24.com platform
            const bookingRequestBody = [{
                id: booking.bookingId,
                status: 'confirmed'
            }]


            let bookingResponse
            let success
            let attempt = 0


            while (attempt < 2) {
                const bookingRequest = await fetch('https://beds24.com/api/v2/bookings', {
                    method: 'POST',
                    headers: {
                        'token': tok,
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify(bookingRequestBody)
                })
                bookingResponse = await bookingRequest.json()
                if (bookingResponse[0].success) {
                    success = true
                    break
                }

                if (bookingResponse.code === 401) {
                    logger.warn('Beds24 token expired, trying to refresh...')
                    refreshAuthToken()
                    attempt++
                }
                if (attempt === 1) {
                    continue
                }
                break

            }


            if (success) {
                logger.info('booking was successfylly updated on Beds24')
                const updateBookingResult = updateBookingPrepare.run(process.env.PAYMENT_SUCCESSFUL, req.body.merchantTransactionId)
                logger.info({ message: 'booking that was updated', booking })

                sendBookingConfirmation({ id: booking.bookingId, customerName: booking.customerName + ' ' + booking.customerLastName, email: booking.customerEmail, startDate: convertDateString(booking.startDate), endDate: convertDateString(booking.endDate), adults: booking.adults, children: booking.children, nights: getDaysBetween(booking.endDate, booking.startDate), totalPrice: booking.price })
            }

        } catch (error) {
            logger.error(error.message)
        }
    }
})


app.get('/comingsoon', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'comingsoon.html'))
})

app.get("/error", (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'error.html'))
})




// cron job to cancel any booking that didn't make it through the payment process
// cron.schedule(`*/${process.env.CRON_CLEAR_BOOKINGS_TIME} * * * *`, async () => {
//     logger.info("Checking for false bookings...");
//     try {
//         const retrieveFalseBookings = db.prepare(`SELECT * FROM bookings WHERE bookingStatus = ?`)
//         const falseBookings = retrieveFalseBookings.all(process.env.PAYMENT_PENDING)
//         if (falseBookings.length > 0) {
//             const cancelBookingsBody = []
//             for (const booking of falseBookings) {
//                 const differenceInMs = Date.now() - booking.createdAt
//                 const timePassed = Math.floor(differenceInMs / 1000 / 60);
//                 logger.info(timePassed)
//                 if (timePassed > 180) {
//                     logger.info({ message: 'elgible for deletion' })
//                     logger.info({ message: booking })
//                     cancelBookingsBody.push({ id: booking.bookingId, status: "cancelled" })
//                 } else { logger.info('booking found but not eligible for deletion') }
//             }
//
//             logger.info(cancelBookingsBody)
//
//
//
//             const cancelBookingsRequest = await fetch('https://beds24.com/api/v2/bookings', {
//                 method: 'POST',
//                 headers: {
//                     'token': tok,
//                     'Accept': 'application/json'
//                 },
//                 body: JSON.stringify(cancelBookingsBody)
//             })
//
//             const cancelBookingsResponse = await cancelBookingsRequest.json()
//             logger.info(cancelBookingsResponse)
//
//             const deleteFalseBookings = db.prepare(`DELETE FROM bookings WHERE bookingStatus = ?`)
//             const deleteFalseBookingsResult = deleteFalseBookings.run(process.env.PAYMENT_PENDING)
//         }
//     } catch (error) {
//         logger.error(error)
//     }
// })


// app.options('/uploadimage', (req, res) => {
//     console.log('alo ba')
//     res.status(200)
// })
//
//
app.post('/upload', upload.any(), (req, res) => {

    if (!req.files || req.files.length === 0) {
        return res.json({ success: false, msg: "No files uploaded" });
    }

    const filenames = req.files.map(file => file.filename);

    res.json({
        success: true,
        data: {
            files: filenames,
            baseurl: `http://localhost:5000/uploads/`,
            isImages: req.files.map(() => true),
            code: 220
        }
    });
});



app.post('/saveblog', express.json(), (req, res) => {
    console.log(req.body)

    const date = new Date()
    const uniqueId = formatDate(date)
    console.log(uniqueId)
    const { title, title_img, editor, blogid } = req.body

    if (!title || !title_img || !editor) {
        return res.status(400).json({ success: false, message: "Title, title image or blog content are missing!" })
    }


    if (blogid === null) {
        console.log("saving new blog")
        try {
            const filename = `${uniqueId}.json`
            const filePath = path.join(__dirname, 'public/blogs', filename)

            const entireBlog = req.body
            entireBlog.blogid = uniqueId

            fs.writeFileSync(filePath, JSON.stringify(entireBlog, null, 2), 'utf8')

            res.json({ success: true, message: "Blog saved successfully", blogid: uniqueId })

        } catch (error) {
            console.log(error)
            res.status(500).json({ success: false, message: "Failed to save blog" })

        }


    } else {
        console.log("editing existing blog")


        try {
            const filename = `${blogid}.json`
            const filePath = path.join(__dirname, 'public/blogs', filename)

            if (!fs.existsSync(filePath)) {
                return res.status(404).json({ success: false, message: "Blog not found!" })
            }

            const entireBlog = JSON.stringify(req.body, null, 2)

            fs.writeFileSync(filePath, entireBlog, 'utf8')
            res.json({ success: true, message: "Blog updated successfully!" })

        } catch (error) {
            console.log(error)
            res.status(500).json({ success: false, message: "Failed to save blog" })
        }




    }
})


app.delete("/api/blog/:id", (req, res) => {
    const blogId = req.params.id


    if (!blogId) {
        return res.status(400).json({ success: false, message: "BlogId is required!" })
    }


    const filename = `${blogId}.json`
    console.log(filename)
    const filePath = path.join(__dirname, 'public/blogs', filename)
    try {


        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath)
            res.json({ success: true, message: "Blog deleted successfully" })
        } else {
            res.status(404).json({ success: false, message: "Blog not found" })
        }

    } catch (error) {
        console.log(error)
        res.status(500).json({ success: false, message: "Failed to delete blog" })

    }
})





app.get("/blogeditor", (req, res) => {

    res.sendFile(path.join(__dirname, 'public', 'blog_editor.html'))
})




app.get('/*splat', (req, res) => {

    res.sendFile(path.join(__dirname, 'public', 'index.html'))
})


app.listen(port, async () => {
    console.log('listening on port 5000')
    logger.info('listening on port 5000')
    await refreshAuthToken()


    try {
        db = new Database('./kozarapanoramicresort.db')
        logger.info(db)
    } catch (error) {

        logger.error(error)
    }
})


