
require('dotenv').config()

const crypto = require('crypto')
const winston = require('winston')
const express = require('express')
const path = require('path')
const ical = require('ical-generator')
const cron = require('node-cron')
const cors = require('cors')
const Database = require('better-sqlite3')
const fileUpload = require('express-fileupload')
const fs = require('fs')
const nodemailer = require('nodemailer')
require('winston-daily-rotate-file')
const multer = require('multer')
const session = require('express-session');

let db
let paypalToken

const templatePathIndex = path.join(__dirname, 'public', 'index.html')
let htmlTemplateIndex = fs.readFileSync(templatePathIndex, 'utf8')

const templatePathNotice = path.join(__dirname, 'public', 'notice.html')
let htmlTemplateNotice = fs.readFileSync(templatePathNotice, 'utf8')


const templatePathBlog = path.join(__dirname, 'public', 'blog-post.html')
let htmlTemplateBlog = fs.readFileSync(templatePathBlog, 'utf8')



const templatePathBlogs = path.join(__dirname, 'public', 'blogs.html')
let htmlTemplateBlogs = fs.readFileSync(templatePathBlogs, 'utf8')


const admin_username = 'dragana'
const admin_password = 'kozarapanoramicresort'
const session_secret = 'necemociovenoci'


const languages = {
    en: JSON.parse(fs.readFileSync(path.join(__dirname, 'languages', 'en.json'), 'utf8')),
    de: JSON.parse(fs.readFileSync(path.join(__dirname, 'languages', 'de.json'), 'utf8')),
    it: JSON.parse(fs.readFileSync(path.join(__dirname, 'languages', 'it.json'), 'utf8')),
    sr: JSON.parse(fs.readFileSync(path.join(__dirname, 'languages', 'sr.json'), 'utf8')),
}

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
    limits: { fileSize: 10 * 1024 * 1024 }, // Limit file size to 10MB
    fileFilter: fileFilter
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

function loadLatestBlogs() {

    try {

        const blogsDir = path.join(__dirname, 'public/blogs')
        const files = fs.readdirSync(blogsDir)
        logger.info(files)
        const blogs = files.sort().reverse().slice(0, 3).map(filename => {
            const filePath = path.join(blogsDir, filename)
            const blogData = JSON.parse(fs.readFileSync(filePath, 'utf8'))
            const data = { title: blogData.title, title_img: blogData.title_img, blogid: blogData.blogid }
            return data
        })


        return blogs

    } catch (error) {
        logger.info(error.message)
        return null
    }
}

function loadAllBlogs() {

    try {

        const blogsDir = path.join(__dirname, 'public/blogs')
        const files = fs.readdirSync(blogsDir)
        logger.info(files)
        if (files.length === 0) { return null }
        const blogs = files.sort().reverse().map(filename => {
            const filePath = path.join(blogsDir, filename)
            const blogData = JSON.parse(fs.readFileSync(filePath, 'utf8'))
            const data = { title: blogData.title, title_img: blogData.title_img, blogid: blogData.blogid }
            return data
        })


        return blogs

    } catch (error) {
        logger.info(error.message)
        return null
    }
}



function renderIndex(res, lang) {

    const t = languages[lang] || languages['en']
    let renderedHtml = htmlTemplateIndex
    let blogs = loadLatestBlogs()

    logger.info(blogs)
    logger.info('blogovi')
    if (blogs === null || blogs.length === 0) {
        renderedHtml = renderedHtml.replace('{{NO_BLOGS}}', 'flex')
        renderedHtml = renderedHtml.replace('{{YES_BLOGS}}', 'none')
        renderedHtml = renderedHtml.replace('{{MORE_BLOGS}}', 'none')

    } else {
        renderedHtml = renderedHtml.replace('{{NO_BLOGS}}', 'none')
        renderedHtml = renderedHtml.replace('{{YES_BLOGS}}', 'grid')
        renderedHtml = renderedHtml.replace('{{MORE_BLOGS}}', 'none')
        if (blogs.length > 3) {
            renderedHtml = renderedHtml.replace('{{MORE_BLOGS}}', 'block')

        }

        // blogs.forEach(blog => {
        //     renderedHtml = renderedHtml.replace('{{BLOG_TITLE}}', blog.title)
        //     renderedHtml = renderedHtml.replace('{{BLOG_IMG}}', blog.title_img)
        //     renderedHtml = renderedHtml.replace('{{BLOG_ID}}', blog.blogid)
        //
        // });


        let blogContent = ''
        blogs.forEach(blog => {

            blogContent += `<div class="blog-card">
<img src="${blog.title_img}" class="blog-img" alt="Blog 1 cover image" />
<h4 style="min-height: 2.5em">${blog.title}</h4>
                    <a class="read-blog" href="https://translate.google.com/translate?sl=sr&tl={{language_code}}&u=https://www.kozarapanoramicresort.ba/blog/${blog.blogid}&op=translate">{{read_article}}</a>
</div>`
        })
        renderedHtml = renderedHtml.replace('{{BLOGS_TEMPLATE}}', blogContent)


    }


    renderedHtml = renderedHtml.replace('<html lang="en" class="sl-theme-light">', `<html lang="${lang}" class="sl-theme-light">`)

    Object.keys(t).forEach(key => {

        const regex = new RegExp(`{{${key}}}`, 'g');
        renderedHtml = renderedHtml.replace(regex, t[key]);
    })




    res.send(renderedHtml)
}



function renderNotice(res, lang) {
    const t = languages[lang] || languages['en']
    let renderedHtml = htmlTemplateNotice


    renderedHtml = renderedHtml.replace('<html lang="en" class="sl-theme-light">', `<html lang="${lang}" class="sl-theme-light">`)

    Object.keys(t).forEach(key => {

        const regex = new RegExp(`{{${key}}}`, 'g');
        renderedHtml = renderedHtml.replace(regex, t[key]);
    })

    res.send(renderedHtml)
}

function renderBlog(res, lang, id) {
    const t = languages[lang] || languages['en']

    let renderedHtml = htmlTemplateBlog
    renderedHtml = renderedHtml.replace('<html lang="en" class="sl-theme-light">', `<html lang="${lang}" class="sl-theme-light">`);

    Object.keys(t).forEach(key => {

        const regex = new RegExp(`{{${key}}}`, 'g');
        renderedHtml = renderedHtml.replace(regex, t[key]);
    })
    const filePath = path.join(__dirname, 'public/blogs', `${id}.json`)
    try {
        if (!fs.existsSync(filePath)) {
            return res.status(404).send('Blog not found')
        }

        const blog = JSON.parse(fs.readFileSync(filePath, 'utf8'))


        Object.keys(t).forEach(key => {

            const regex = new RegExp(`{{${key}}}`, 'g');
            renderedHtml = renderedHtml.replace(regex, t[key]);
        })
        renderedHtml = renderedHtml.replace('{{BLOG_TITLE}}', blog.title || 'Untitled');
        renderedHtml = renderedHtml.replace('{{BLOG_TITLE}}', blog.title || 'Untitled');
        renderedHtml = renderedHtml.replace('{{BLOG_TITLE}}', blog.title || 'Untitled');
        renderedHtml = renderedHtml.replace(/\{\{BLOG_TITLE\}\}/g, blog.title || 'Untitled');
        renderedHtml = renderedHtml.replace('{{BLOG_CONTENT}}', blog.editor || 'Untitled');
        renderedHtml = renderedHtml.replace('{{OG_IMAGE}}', blog.title_img || 'Untitled');
        renderedHtml = renderedHtml.replace(/\{\{BLOG_ID\}\}/g, id || 'Untitled');


    } catch (error) {
        logger.info(error)

    }
    res.send(renderedHtml)
}


function renderAllBlogs(res, lang) {

    const t = languages[lang] || languages['en']

    let renderedHtml = htmlTemplateBlogs
    renderedHtml = renderedHtml.replace('<html lang="en" class="sl-theme-light">', `<html lang="${lang}" class="sl-theme-light">`);


    let blogs = loadAllBlogs()
    if (blogs === null) {

        renderedHtml = renderedHtml.replace('{{NO_BLOGS}}', 'block')
        renderedHtml = renderedHtml.replace('{{BLOGS_SECTION}}', '')
        return res.send(renderedHtml)
    } else {

        let blogContent = ''
        blogs.forEach(blog => {

            blogContent += `<div class="blog-card">
<img src="${blog.title_img}" class="blog-img" alt="Blog 1 cover image" />
<h4 style="min-height: 2.5em">${blog.title}</h4>
                    <a class="read-blog" href="/{{language_code}}/blog/${blog.blogid}">{{read_article}}</a>
</div>`
        })
        renderedHtml = renderedHtml.replace('{{BLOGS_SECTION}}', blogContent)
        renderedHtml = renderedHtml.replace('{{NO_BLOGS}}', 'none')


        Object.keys(t).forEach(key => {

            const regex = new RegExp(`{{${key}}}`, 'g');
            renderedHtml = renderedHtml.replace(regex, t[key]);
        })
        res.send(renderedHtml)
    }



}










//routes




const app = express()
app.use(cors())
const port = 5000
app.use(express.static(path.join(__dirname, 'public'), { index: false }))

app.use(express.urlencoded({ extended: true }))
app.use(session({
    secret: session_secret || 'fallback_secret',
    resave: true,
    rolling: true,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to true if/when you move to HTTPS
        maxAge: 24 * 60 * 60 * 1000 // Session lasts 24 hours
    }
}));



function isAuthenticated(req, res, next) {
    if (req.session.user) {
        return next();
    }
    res.redirect('/login');
}

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

app.listen(port, async () => {
    console.log('listening on port 5000')
    logger.info('listening on port 5000')
    logger.info(__dirname)
    await refreshAuthToken()
    paypalToken = await getPaypalAccessToken()
    logger.info(tok)


    try {
        db = new Database('./kozarapanoramicresort.db')
        logger.info(db)
    } catch (error) {

        logger.error(error)
    }
})



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

let tok


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


//TODO buletproof this method
async function getPaypalAccessToken() {

    try {
        const auth = Buffer.from(`${process.env.PAYPAL_CLIENT}:${process.env.PAYPAL_SECRET}`).toString('base64')

        const response = await fetch(`${process.env.PAYPAL_URL}/v1/oauth2/token`, {
            method: 'POST',
            body: 'grant_type=client_credentials',
            headers: {
                Authorization: `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        })
        const data = await response.json()
        console.log(data)
        return data.access_token


    } catch (error) {

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

    logger.info({
        message: "findAvailableUnits"
    })
    logger.info({ messaage: dailyStatus })


    //iterating through the data from beds24
    for (const date in dailyStatus) {

        if (Object.prototype.hasOwnProperty.call(dailyStatus, date)) {
            const dayUnits = dailyStatus[date]

            for (const unitId of unitIds) {
                if (dayUnits[unitId] === 1) {
                    logger.info(dayUnits[unitId])
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



app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === admin_username && password === admin_password) {
        req.session.user = username;
        return res.redirect('/blogeditor'); // Redirect straight to your editor
    }
    res.redirect('/login?error=true');

});

app.get('/', (req, res) => {
    renderIndex(res, 'en')
})

app.get('/', (req, res) => {
    renderIndex(res, 'en')
})

app.get(['/en', '/de', '/fr', '/it', '/sr'], (req, res) => {
    // Manually get the language from the URL since we aren't using a named param
    const lang = req.path.replace('/', '');
    console.log(lang.substring(0, 2))
    renderIndex(res, lang.substring(0, 2));
});

app.get(['/notice', '/en/notice'], (req, res) => {
    renderNotice(res, 'en')
})

app.get(['/de/notice', '/fr/notice', '/it/notice', '/sr/notice'], (req, res) => {
    // Extract language: "/de/notice" -> split by "/" -> ["", "de", "notice"] -> get index 1
    const lang = req.path.split('/')[1];
    renderNotice(res, lang);
});


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
            logger.info({ message: availabilityResponse })
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



app.post('/api/paypal/orders', express.json(), async (req, res) => {



    console.log(req.body)



    const availabilityParams = new URLSearchParams({
        startDate: req.body.startDate,
        endDate: req.body.endDate
    })


    let availabilityData
    let availabilityAttempt = 0
    let availabilitySuccess


    while (availabilityAttempt < 2) {
        try {
            const availabilityRequest = await fetch(`https://beds24.com/api/v2/inventory/rooms/availability?${availabilityParams}`, {
                method: 'GET',
                headers: {
                    'token': tok,
                    'Accept': 'application/json'
                }
            })


            availabilityData = await availabilityRequest.json()


            if (availabilityData.success) {
                availabilitySuccess = true
                break
            }

            if (availabilityData.code === 401) {
                await refreshAuthToken()
                availabilityAttempt++
            }

            if (availabilityAttempt === 1) {
                continue
            }
            break
        } catch (error) {

            console.log(error)
        }
    }


    if (availabilitySuccess) {
        const availabilityObject = availabilityData.data[0].availability
        const availabilityEntries = Object.entries(availabilityObject)
        const totalDays = availabilityEntries.length
        if (totalDays === 0) {
            logger.info(`No chalets were available from ${req.body.startDate} - ${req.body.endDate}`)
            res.status(400).json({ success: false, message: 'No chalets are available for that set of dates!' })
            return

        }

        const isPatternCorrect = availabilityEntries.every(([date, isAvailable], index) => {
            return isAvailable === true
        })

        if (!isPatternCorrect) {
            logger.info(`No chalets were available from ${req.body.startDate} - ${req.body.endDate}`)
            res.status(400).json({ success: false, message: 'No chalets are available for that set of dates!' })
            return
        }


    }
    //at this point room is available and we proceed to payment
    //
    //

    const offerParams = new URLSearchParams({
        arrival: req.body.startDate,
        departure: req.body.endDate,
        numAdults: req.body.numAdults,
        numChildren: req.body.numChildren
    })


    try {

        //getting the offer from beds24
        const offer = await fetch(`https://beds24.com/api/v2/inventory/rooms/offers?${offerParams}`, {
            method: 'GET',
            headers: {
                'token': tok,
                'Accept': 'application/json'
            }
        })


        const offerData = await offer.json()
        logger.info(offerData.data[0].offers[0])
        console.log(offerData)
        if (offerData.success) {
            logger.info('Offer is a success')

            const response = await fetch(`${process.env.PAYPAL_URL}/v2/checkout/orders`, {
                method: 'POST',
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${paypalToken}`
                },
                body: JSON.stringify({
                    intent: 'CAPTURE',
                    purchase_units: [{
                        amount: { currency_code: 'EUR', value: offerData.data[0].offers[0].price * 0.53 },
                        description: `Chalet booking for ${req.body.customerName} ${req.body.customerLastName} from ${req.body.startDate} to ${req.body.endDate}`
                    }],
                    application_context: {
                        shipping_preference: 'NO_SHIPPING',
                        user_action: 'PAY_NOW'
                    }
                })
            })

            const order = await response.json()

            logger.info(order)

            const insertBooking = db.prepare(`INSERT INTO bookings (customerName, customerLastName, customerEmail, customerPhone, billingAddress, billingCity, billingCountry, billingPostCode, startDate, endDate, bookingId, bookingStatus, bookingTransactionId, createdAt, adults, children, price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

            if (order.status === 'CREATED') {
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
                    const insertBookingResult = insertBooking.run(req.body.customerName, req.body.customerLastName, req.body.customerEmail, req.body.customerPhone, req.body.billingAddress, req.body.billingCity, req.body.billingCountry, req.body.billingPostCode, req.body.startDate, req.body.endDate, bookingResponse[0].new.id.toString(), process.env.PAYMENT_PENDING, order.id, Date.now(), Number.parseInt(req.body.numAdults), Number.parseInt(req.body.numChildren), offerData.data[0].offers[0].price)

                    logger.info({ message: insertBookingResult })
                }
            }
            return res.status(response.status).json({ success: true, order })

        }
    } catch (error) {
        logger.error(error.message)

    }
})



app.post('/api/paypal/orders/capture', express.json(), async (req, res) => {

    try {

        const response = await fetch(`${process.env.PAYPAL_URL}/v2/checkout/orders/${req.body.orderId}/capture`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${paypalToken}`
            }
        })

        const captureData = await response.json()
        if (captureData.status === 'COMPLETED') {
            const updateBooking = db.prepare(`UPDATE bookings SET bookingStatus = ? WHERE bookingTransactionId = ?`)
            const getBooking = db.prepare(`SELECT * FROM bookings WHERE bookingTransactionId = ?`)


            const booking = getBooking.get(captureData.id)
            console.log(booking)

            const bookingBedsBody = [{
                id: booking.bookingId,
                status: 'confirmed'
            }]

            const bookingBeds = await fetch('https://beds24.com/api/v2/bookings', {
                method: 'POST',
                headers: {
                    'token': tok,
                    'Accept': 'application/json'
                },
                body: JSON.stringify(bookingBedsBody)
            })

            const bookingResponse = await bookingBeds.json()
            if (bookingResponse[0].success) {
                logger.info('Beds24 booking update success')
                logger.info({ message: 'updated booking info', booking })
                const updateBookingDatabase = updateBooking.run(process.env.PAYMENT_SUCCESSFUL, captureData.id)

            }
        }





        console.log(captureData)
        return res.json({ success: true, url: `/booking/check-payment?tid=${captureData.id}` })
    } catch (error) {

        logger.error(error.message)
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


app.post('/upload', upload.any(), (req, res) => {

    if (!req.files || req.files.length === 0) {
        return res.json({ success: false, msg: "No files uploaded" });
    }

    const filenames = req.files.map(file => file.filename);

    res.json({
        success: true,
        data: {
            files: filenames,
            baseurl: `/uploads/`,
            isImages: req.files.map(() => true),
            code: 220
        }
    });
});


app.post('/api/saveblog', isAuthenticated, express.json(), (req, res) => {
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


app.delete("/api/blog/:id", isAuthenticated, (req, res) => {
    const blogId = req.params.id


    if (!blogId) {
        return res.status(400).json({ success: false, message: "BlogId is required!" })
    }


    const filename = `${blogId}.json`
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

app.get("/api/blog/getall", isAuthenticated, (req, res) => {

    try {

        const blogsDir = path.join(__dirname, 'public/blogs')
        const files = fs.readdirSync(blogsDir)
        console.log(files)
        const blogs = files.map(filename => {
            const filePath = path.join(blogsDir, filename)
            const blogData = JSON.parse(fs.readFileSync(filePath, 'utf8'))

            const data = { title: blogData.title, title_img: blogData.title_img, blogid: blogData.blogid }
            return data
        })
        console.log(blogs)

        return res.json({ success: true, message: "All blogs retrieved successfully", body: blogs })

    } catch (error) {
        console.log(error)
        return res.status(500).json({ success: false, message: "Failed to retrieve blogs" })

    }
})


app.get('/api/blog/latest', (req, res) => {

    try {

        const blogsDir = path.join(__dirname, 'public/blogs')
        const files = fs.readdirSync(blogsDir)
        logger.info(files)
        const blogs = files.sort().reverse().slice(0, 3).map(filename => {
            const filePath = path.join(blogsDir, filename)
            const blogData = JSON.parse(fs.readFileSync(filePath, 'utf8'))
            const data = { title: blogData.title, title_img: blogData.title_img, blogid: blogData.blogid }
            return data
        })

        return res.json({ success: true, message: "Latest blogs retrieved successfully", body: blogs })


    } catch (error) {
        logger.info(error.message)
        res.status(500).json({ success: false, message: "Failed to retrieve blogs" })
    }

})


app.get('/api/blog/:id', isAuthenticated, (req, res) => {

    const blogId = req.params.id
    if (!blogId) {
        return res.status(400).json({ success: false, message: "BlogId is required" })
    }
    console.log(blogId)

    const filename = `${blogId}.json`
    const filePath = path.join(__dirname, 'public/blogs', filename)
    try {
        const blog = JSON.parse(fs.readFileSync(filePath, 'utf8'))
        return res.json({ success: true, message: "Blog retrieved successfully", body: blog })
    } catch (error) {
        console.log(error)
        res.status(500).json({ success: false, message: "Failed to retrieve blog" })
    }

})



app.get("/blogeditor", isAuthenticated, (req, res) => {

    res.sendFile(path.join(__dirname, 'public', 'blog_editor.html'))
})


app.get(['/blog/:id', '/en/blog/:id'], (req, res) => {
    const blogId = req.params.id
    renderBlog(res, 'en', blogId)
})


app.get(['/de/blog/:id', '/it/blog/:id', '/sr/blog/:id'], (req, res) => {
    const lang = req.path.split('/')[1];
    const blogId = req.params.id
    renderBlog(res, lang, blogId)
})


app.get(['/blogs', '/en/blog'], (req, res) => {
    renderAllBlogs(res, 'en')
})


app.get(['/de/blogs', '/it/blogs', '/sr/blogs'], (req, res) => {
    const lang = req.path.split('/')[1];
    renderAllBlogs(res, lang)
})


app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'))
})


app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});



app.get('/*splat', (req, res) => {

    renderIndex(res, 'en')
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
//             if (cancelBookingsBody.length === 0) {
//                 return
//             }
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
//             if (cancelBookingsResponse.success) {
//                 const deleteFalseBookings = db.prepare(`DELETE FROM bookings WHERE bookingStatus = ?`)
//                 const deleteFalseBookingsResult = deleteFalseBookings.run(process.env.PAYMENT_PENDING)
//
//             }
//
//         }
//     } catch (error) {
//         logger.error(error)
//     }
// })







