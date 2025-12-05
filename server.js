require('dotenv').config()

const crypto = require('crypto')
const winston = require('winston')
const express = require('express')
const path = require('path')
const ical = require('ical-generator')
const cron = require('node-cron')
const Database = require('better-sqlite3')
const fileUpload = require('express-fileupload')
const fs = require('fs')
let db


const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' })
    ]
})



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


const UPLOAD_DIR = path.join(process.cwd(), 'images')
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const port = 5000;

app.set('view engine', 'ejs');
// app.use(express.static(path.join(__dirname, 'public')))
//
//
app.use('/images', express.static(UPLOAD_DIR))



function daysBetween(start_date, end_date) {
    const start = new Date(start_date)
    const end = new Date(end_date)

    const timeDiff = end.getTime() - start.getTime()

    return Math.ceil(timeDiff / (1000 * 3600 * 24))
}




function formatDate(date) {
    const iso = date.toISOString();
    const datePart = iso.slice(0, 10); // YYYY-MM-DD
    const timePart = iso.slice(11, 19).replace(/:/g, ''); // HHMMSS
    return `${datePart}-${timePart}`;
}


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


function dateInRange(start, end, check) {
    const startDate = new Date(start)
    const endDate = new Date(end)
    const checkDate = new Date(check)
    if (startDate <= checkDate && endDate >= checkDate) {
        return true
    } else return false
}

function calculatePrice(checkIn, checkOut, chalet, code) {
    let totalPrice = 0
    let returnData = {}


    const getBasePrice = db.prepare(`SELECT * FROM base_prices WHERE chalet_id = ?`)
    const basePrice = getBasePrice.get(chalet)
    logger.info(basePrice)

    // const getSpecialPrices = db.prepare(`SELECT * FROM special_prices WHERE ((date(start_date) >= ? AND date(start_date) <= ?) OR (date(end_date) >= ? AND date(end_date) <= ?)) AND chalet = ? ORDER BY start_date`)
    // const specialPrices = getSpecialPrices.all(checkIn, checkOut, checkIn, checkOut, Number(chalet))
    const getSpecialPrices = db.prepare(`SELECT * FROM special_prices WHERE date(start_date) < date(?) AND date(end_date) > date(?) AND chalet = ? ORDER BY start_date`);
    const specialPrices = getSpecialPrices.all(checkOut, checkIn, Number(chalet));


    const getDiscountCode = db.prepare(`SELECT * FROM discount_codes WHERE code = ?`)
    let discountCode = getDiscountCode.get(code)

    if (discountCode) {
        const chaletIds = JSON.parse(discountCode.chalets)
        if (!chaletIds.contains(Number(chalet))) {
            discountCode = null;
        }
    }



    let currentDate = new Date(checkIn)
    const checkOutDate = new Date(checkOut)
    while (currentDate <= checkOutDate) {
        const specialPrice = specialPrices.find(sp => {
            return dateInRange(sp.start_date, sp.end_date, currentDate.toISOString())
        })

        if (specialPrice) {
            totalPrice += Number(specialPrice.price)
            logger.info({
                message: 'special price found',
                current_date: currentDate,
                price: specialPrice.price
            })
        } else {
            totalPrice += Number(basePrice.price)
            logger.info({
                message: 'no special price, base price used',
                current_date: currentDate,
                price: basePrice.price
            })
        }
        currentDate.setDate(currentDate.getDate() + 1)
    }


    logger.info({
        message: 'price before possible discounts',
        price: totalPrice
    })


    if (discountCode) {

        if (dateInRange(discountCode.valid_from, discountCode.valid_to, checkIn) && discountCode.max_usage_count > discountCode.usage_count) {
            logger.info('discount code applicable')
            returnData.discountCode = discountCode.code
            if (discountCode.discount_type === 'percentage') {
                totalPrice -= (totalPrice * Number('0.' + discountCode.discount_value))
            } else totalPrice -= discountCode.discount_value

        } else logger.info('discount code not applicable')
    }

    logger.info({
        message: 'price after possible discounts',
        price: totalPrice
    })
    returnData.totalPrice = totalPrice
    logger.info(returnData)
    return returnData
}


app.post('/uploadimage', fileUpload({ limits: { fileSize: 10 * 1024 * 1024 } }), (req, res) => {
    logger.info(req)

    const f = req.files?.image
    if (!f) return res.status(400).json({ success: 0, message: 'No file' })
    if (!f.mimetype?.startsWith('image/')) res.status(400).json({ success: 0, message: 'Unsupported type' })


    const destination = path.join(UPLOAD_DIR, req.files.image.name)

    f.mv(destination, (err) => {
        if (err) res.status(500).json({ success: 0, message: 'Save failed' })

        res.status(200).json({ success: 1, file: { url: `${req.protocol}://${req.get('host')}/images/${req.files.image.name}` } })
    })
})


app.post('/uploadimagebyurl', express.json(), async (req, res) => {

    try {

        const { url } = req.body || {}
        if (!url) return res.status(400).json({ success: 0, message: 'Missing url' })


        const response = await fetch(url)
        if (!response.ok) return res.status(400).json({ success: 0, message: `Fetch ${response.status}` })

        const contentType = response.headers.get('content-type') || ''
        if (!contentType.startsWith('image/')) return res.status(400).json({ success: 0, message: 'Not an image' })

        const ext = (contentType.split('/')[1] || 'jpg').split(';')[0].replace('jpeg', 'jpg')

        const fileName = `${crypto.randomUUID()}.${ext}`

        const filePath = path.join(UPLOAD_DIR, fileName)


        await fs.promises.writeFile(filePath, Buffer.from(await response.arrayBuffer()))


        res.json({ success: 1, file: { url: `${req.protocol}://${req.get('host')}/images/${fileName}` } });




    } catch (error) {
        res.status(500).json({ success: 0, message: error.message })
    }

})


app.get('/getdata', (req, res) => {

    const getCurrentBookings = db.prepare(`SELECT * FROM bookings WHERE check_in_date >= date('now', 'start of month') ORDER BY check_in_date`)
    const bookings = getCurrentBookings.all()

    const getSpecialPrices = db.prepare(`SELECT * FROM special_prices WHERE start_date >= date('now', 'start of month')`)
    const specialPrices = getSpecialPrices.all()


    // const getDiscounts = db.prepare(`SELECT * FROM discount_codes WHERE valid_from <= date('now') AND valid_to >= date('now') AND usage_count < max_usage_count`)
    // const discounts = getDiscounts.all();

    const getBasePrices = db.prepare(`SELECT * FROM base_prices`)
    const basePrices = getBasePrices.all();



    const returnData = {}
    for (let index = 1; index <= 5; index++) {
        returnData[index.toString()] = {
            reservedDates: [],
            // discounts: [],
            specialDates: []
        }

    }

    bookings.forEach(booking => {
        const bookingData = {
            check_in: booking.check_in_date,
            check_out: booking.check_out_date
        }
        returnData[booking.chalet_id].reservedDates.push(bookingData)
    })


    specialPrices.forEach(specialPrice => {
        const startDate = specialPrice.start_date.substring(5);
        returnData[specialPrice.chalet].specialDates.push({
            start: specialPrice.start_date,
            end: specialPrice.end_date,
            price: specialPrice.price
        })
    })

    // discounts.forEach(d => {
    //     const discountData = {
    //         value: d.discount_value,
    //         type: d.discount_type,
    //         discount_id: d.id
    //     }
    //     returnData[d.chalet_id].discounts.push(discountData)
    // })

    basePrices.forEach(price => {
        returnData[price.chalet_id].basePrice = price.price
    })

    logger.info({
        message: 'data to be returned',
        data: returnData
    })

    res.json(returnData).status(200)
})


app.get('/', (req, res) => {
    // res.sendFile(path.join(__dirname, 'public', 'payment.html'))

    res.render('payment')
})



app.get('/calendartest', async (req, res) => {

    try {
        console.log('calendar called', new Date())

        const bookings = [
            {
                start: new Date('2025-08-25'),
                end: new Date('2025-08-30'),
                uid: 'booking123',
                summary: 'web app booking'
            },
            {
                start: new Date('2025-09-01'),
                end: new Date('2025-09-12'),
                uid: 'booking1234',
                summary: 'web app bok'
            },
            {
                start: new Date('2025-09-13'),
                end: new Date('2025-09-22'),
                uid: 'booking12345',
                summary: 'web app aaa'
            }
        ]




        const cal = ical.default({
            name: 'Property availability Calendar',
            timezone: 'Europe/Sarajevo'
        })


        bookings.forEach(booking => {
            cal.createEvent({
                name: booking.name,
                end: booking.end,
                summary: booking.summary,
                uid: booking.uid,
                method: 'PUBLISH',
                status: 'CONFIRMED'
            })
        })


        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="calendar.ics"');
        res.send(cal.toString());
    } catch (error) {
        logger.info(error)
    }


})

app.post('/payment', express.json(), async (req, res) => {

    logger.info(req.body)
    const date = new Date()
    const uniqueId = formatDate(date)


    const priceData = calculatePrice(req.body.check_in, req.body.check_out, req.body.chalet, req.body.discount)
    // const priceData = {
    //     discountCode: "OPA",
    //     totalPrice: 400
    // }
    logger.info(priceData)


    const requestBody = {
        merchantTransactionId: uniqueId,
        amount: `${priceData.totalPrice}`, errorUrl: "https://28a8206d274f.ngrok-free.app/error", successUrl: "https://28a8206d274f.ngrok-free.app/", callbackUrl: "https://28a8206d274f.ngrok-free.app/callback", currency: "BAM", transactionToken: `${req.body.token}`, customer: {
            billingAddress1: `${req.body.billingAddress}`,
            billingCity: `${req.body.billingCity}`,
            billingCountry: `${req.body.country}`,
            billingPostcode: `${req.body.billingZIP}`,
            email: `${req.body.email}`

        }
    }
    logger.info(requestBody)

    const method = 'POST'
    const requestURI = `/api/v3/transaction/${process.env.API_KEY}/debit`
    const contentType = 'application/json; charset=utf-8'
    const jsonBody = JSON.stringify(requestBody)


    const basicAuth = generateBasicAuth(process.env.USERNAME, process.env.PASSWORD)
    const signature = generateSignature(method, jsonBody, contentType, date.toUTCString(), requestURI, process.env.SHARED_SECRET)


    const headers = {
        'Content-Type': contentType,
        'Date': date.toUTCString(),
        'Authorization': `Basic ${basicAuth}`,
        'Accept': 'application/json',
        'X-Signature': signature
    };

    try {
        const response = await fetch(`https://gateway.bankart.si/api/v3/transaction/${process.env.API_KEY}/debit`, {
            method: method,
            headers: headers,
            body: jsonBody
        })

        const responseData = await response.json()

        const uuid = responseData.uuid
        res.json({
            url: responseData.redirectUrl
        })

        logger.info(responseData)
        if (responseData.success) {
            const checkCustomer = db.prepare(`
                SELECT * FROM customers WHERE email = ? AND phone = ? AND name = ?
                `);

            const insertCustomer = db.prepare(`
                INSERT INTO customers (email, phone, name) 
                VALUES (?, ?, ?)
                `);

            try {
                let customer = checkCustomer.get(req.body.email, "phone_number", req.body.card_holder);

                if (customer) {
                    logger.info({
                        message: 'customer already exists',
                        cust: customer
                    })
                } else {
                    const result = insertCustomer.run(req.body.email, 'phone_number', req.body.card_holder);
                    customer = {
                        id: result.lastInsertRowid,
                        email: req.body.email,
                        phone: req.body.phone,
                        name: req.body.card_holder
                    };
                    logger.info({
                        message: 'new customer created',
                        cust: customer
                    })
                }
                let discount;
                if (priceData.discountCode) {
                    discount = priceData.discountCode
                } else discount = ''

                const insertBooking = db.prepare(`INSERT INTO bookings (id, check_in_date, check_out_date, adult_count, children_count, total_price, status, chalet_id, customer_id, discount_code) VALUES (?,?,?,?,?,?,?,?,?,?)`)

                const result = insertBooking.run(uniqueId, req.body.check_in, req.body.check_out, req.body.adults, req.body.children, priceData.totalPrice, process.env.BOOKING_PENDING, req.body.chalet, customer.id, discount)


            } catch (err) {
                logger.error('Error:', err.message);
            }

        }
    } catch (error) {
        logger.error(error)
    }

})


app.post('/checkdiscountcode', express.json(), (req, res) => {

    const checkDiscountCode = db.prepare(`SELECT * FROM discount_codes WHERE code = ? AND chalet_id = ? AND valid_from <= date('now') AND valid_to >= date('now') AND usage_count < max_usage_count`)
    const result = checkDiscountCode.get(req.body.code, req.body.chalet_id);
    if (result) {
        res.json({ value: result.discount_value, type: result.discount_type })
    } else {
        res.json(false)
    }
})






app.post('/addspecialdate', express.json(), (req, res) => {


    const getSpecialPrices = db.prepare(`SELECT * FROM special_prices WHERE chalet = ? AND date(?) < end_date AND date(?) > start_date `)

    const specialPrices = getSpecialPrices.all(req.body.chalet_id, req.body.start, req.body.end)

    if (specialPrices.length == 0) {
        const addPrice = db.prepare(`INSERT INTO special_prices (start_date, end_date, price, chalet) VALUES(?, ?, ?, ?)`)
        addPrice.run(req.body.start, req.body.end, req.body.price, req.body.chalet_id)
        res.send('Special price added sucessfully').status(201)
    } else res.status(200).send('Timeframes for special prices cannot overlap')


})



app.post('/deletespecialdate', express.json(), (req, res) => {

    const deleteSpecialDate = db.prepare(`DELETE FROM special_prices WHERE start_date = ? AND end_date = ? AND chalet = ?`)
    const result = deleteSpecialDate.run(req.body.start_date, req.body.end_date, req.body.chalet_id)
    logger.info(result)
    if (result.changes >= 1) res.status(200).send("Special date deleted sucessfully")
})

app.put("/updatebaseprice", express.json(), (req, res) => {


    const updateBasePrice = db.prepare(`UPDATE base_prices SET price = ? WHERE chalet_id = ?`)
    const result = updateBasePrice.run(req.body.price, req.body.chalet_id)
    logger.info(result)
    if (result.changes >= 1) {
        res.status(200).send('Price updated sucessfully')
    }
})




app.post('/adddiscountcode', express.json(), (req, res) => {




    const getDiscountWithCode = db.prepare(`SELECT * FROM discount_codes WHERE code = ?`)
    const existingDiscountWithCode = getDiscountWithCode.all(req.body.code)
    if (existingDiscountWithCode.length != 0) {

        res.status(200).send("Discount code with that name already exists!")
    }

    const addDiscountCode = db.prepare(`INSERT INTO discount_codes (code, valid_from, valid_to, max_usage_count, discount_type, discount_value, chalets) VALUES (?,?,?,?,?,?,?)`)
    addDiscountCode.run(req.body.code, req.body.valid_from, req.body.valid_to, req.body.max_usage, req.body.discount_type, req.body.value, JSON.stringify(req.body.chalets))
    res.status(200).send("Discount code added sucessfully")


})


app.post('/deletediscountcode', express.json(), (req, res) => {


    const deleteDiscontCode = db.prepare(`DELETE FROM discount_codes WHERE code = ?`)
    const result = deleteDiscontCode.run(req.body.code)
    logger.info(result)
    if (result.changes >= 1) res.status(200).send('Discount code deleted sucessfully')

})


app.get('/getdiscounts', (req, res) => {

    const getDiscounts = db.prepare('SELECT * FROM discount_codes')
    const discounts = getDiscounts.all()
    logger.info(discounts);

    res.status(200).json(discounts)
})


app.get('/getbookings/:parameter', (req, res) => {

    logger.info(req.params.parameter)

    if (req.params.parameter === 'all') {

        const getBookings = db.prepare('SELECT b.id AS booking_id, b.check_in_date, b.check_out_date, b.adult_count, b.children_count, b.total_price, b.status, b.chalet_id, b.customer_id, b.discount_code, c.id AS customer_id, c.email, c.phone, c.name FROM bookings b JOIN customers c ON b.customer_id = c.id')
        const bookings = getBookings.all()
        res.status(200).json(bookings)

    } else if (req.params.parameter === 'incoming') {

        const getBookings = db.prepare(`SELECT b.id AS booking_id, b.check_in_date, b.check_out_date, b.adult_count, b.children_count, b.total_price, b.status, b.chalet_id, b.customer_id, b.discount_code, c.id AS customer_id, c.email, c.phone, c.name FROM bookings b JOIN customers c ON b.customer_id = c.id WHERE b.check_in_date >= date('now')`)
        const bookings = getBookings.all()
        res.status(200).json(bookings)

    } else {


        const getBookings = db.prepare(`SELECT b.id AS booking_id, b.check_in_date, b.check_out_date, b.adult_count, b.children_count, b.total_price, b.status, b.chalet_id, b.customer_id, b.discount_code, c.id AS customer_id, c.email, c.phone, c.name FROM bookings b JOIN customers c ON b.customer_id = c.id WHERE b.id = ?`)
        const bookings = getBookings.get(req.params.parameter)
        res.status(200).json(bookings)

    }
})


app.post("/callback", express.json(), async (req, res) => {
    logger.info(req.body)
    res.status(200).send('OK')
    logger.info(req.body.result)
    logger.info(req.body.merchantTransactionId)


    if (req.body.result === 'OK') {
        const updateBooking = db.prepare(`UPDATE bookings SET status = ? WHERE id = ?`)

        try {
            const result = updateBooking.run(process.env.BOOKING_PAID, req.body.merchantTransactionId)
            logger.info(result)
            if (result.changes > 0) {
                const getBooking = db.prepare(`SELECT * FROM bookings WHERE id = ?`)
                const updatedBooking = getBooking.get(req.body.merchantTransactionId)
                logger.info(updateBooking)
                if (updatedBooking.discount_code !== '') {
                    const updateDiscount = db.prepare(`UPDATE discount_codes SET usage_count = usage_count + 1 WHERE code = ? AND chalet_id = ?`)
                    const res = updateDiscount.run(updatedBooking.discount_code, updatedBooking.chalet_id)
                    logger.info(res)
                }



            }

        } catch (error) {
            logger.error(error)
        }
    }


})

app.get('/error', (req, res) => {
    res.render('error')
})



// app.get('/*splat', (req, res) => {
//
//     res.sendFile(path.join(__dirname, 'public', 'comingsoon.html'))
// })





app.listen(port, () => {
    logger.info('listening on port 5000')

    try {
        db = new Database('./test.db')
    } catch (error) {

        logger.error(error)
    }
})




